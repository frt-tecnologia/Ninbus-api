# 🔍 Plano Final — CDN Download via hawkBit (CloudFront ou R2)

**Data:** 2026-06-01  
**Status:** ⏳ AGUARDANDO APROVAÇÃO — Versão 4 (com suporte dual CloudFront/R2)  
**Revisão:** v4 — Adicionado modo simplificado para Cloudflare R2

---

## 🏗️ Dois Modos de Operação

O `CdnArtifactUrlResolver` suporta dois modos, selecionados automaticamente pela configuração:

| | Modo A: AWS S3 + CloudFront | Modo B: Cloudflare R2 |
|---|---|---|
| **Quando** | `CDN_KEY_PAIR_ID` preenchido | `CDN_KEY_PAIR_ID` vazio, `CDN_BASE_URL` preenchido |
| **Assinatura** | RSA (CloudFront Signed URL) | HMAC-SHA256 (S3 pre-signed URL) |
| **URL base** | `http://dxxx.cloudfront.net` | `http://r2.seudominio.com` (custom domain) |
| **Infra AWS extra** | CloudFront Distribution + OAC + Key Pair | Nenhum — R2 custom domain basta |
| **Chave privada** | Necessária (RSA PEM) | Não necessária |
| **Complexidade** | Média | **Baixa** |
| **Custo** | CloudFront $0.085/GB | R2 **$0.00 egress** (primeiros 10GB/mês grátis) |
| **HTTP para STM32** | CloudFront terminação :80 | R2 custom domain via Cloudflare (HTTP) |

### Decisão automática no código

```
CDN_BASE_URL preenchido?
  ├─ NÃO → URLs padrão hawkBit (sem CDN)
  └─ SIM
      └─ CDN_KEY_PAIR_ID preenchido?
          ├─ SIM → Modo A: CloudFront RSA Signed URLs
          └─ NÃO → Modo B: R2 S3-compatible Pre-signed URLs
```

---

## Fluxo por Modo

### Modo A: AWS S3 + CloudFront

```
STM32 → hawkBit (poll) → deploymentBase com URL http://dxxx.cloudfront.net/DEFAULT/{sha1}?Signature=...&Key-Pair-Id=...
STM32 → CloudFront (HTTP :80) → S3 (HTTPS via OAC)
STM32 → hawkBit (feedback)
```

### Modo B: Cloudflare R2

```
STM32 → hawkBit (poll) → deploymentBase com URL http://r2.seudominio.com/DEFAULT/{sha1}?X-Amz-Signature=...
STM32 → R2 custom domain (HTTP) → R2 bucket
STM32 → hawkBit (feedback)
```

**Vantagem do R2:** Zero infraextra. O custom domain do R2 via Cloudflare suporta HTTP.
Sem CloudFront, sem Key Pair, sem chave RSA. O STM32 baixa via HTTP direto do R2.

---

## 🔨 Implementação — `CdnArtifactUrlResolver.java` (~100 linhas)

```java
package org.eclipse.hawkbit.artifact.s3;

import com.amazonaws.services.s3.AmazonS3;
import org.eclipse.hawkbit.artifact.urlresolver.ArtifactUrl;
import org.eclipse.hawkbit.artifact.urlresolver.ArtifactUrlResolver;
import org.eclipse.hawkbit.artifact.urlresolver.ArtifactUrlResolver.DownloadDescriptor;
import org.eclipse.hawkbit.artifact.urlresolver.ArtifactUrlResolver.ApiType;

import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.*;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.*;

/**
 * Gera URLs assinadas para download de artefatos via CDN.
 *
 * Dois modos automáticos:
 *   CDN_KEY_PAIR_ID preenchido → AWS CloudFront Signed URL (RSA)
 *   CDN_KEY_PAIR_ID vazio      → Cloudflare R2 Pre-signed URL (HMAC via S3 SDK)
 *
 * Ambos servem HTTP para o STM32 (sem TLS).
 * O device NÃO sabe que está baixando da CDN — segue a URL do deploymentBase.
 */
public class CdnArtifactUrlResolver implements ArtifactUrlResolver {

    private final String cdnBaseUrl;       // http://dxxx.cloudfront.net ou http://r2.seudominio.com
    private final int expirySec;           // 3600
    private final AmazonS3 s3Client;       // Para modo R2 (HMAC signing)
    private final String bucketName;       // Para modo R2

    // CloudFront mode only
    private final String keyPairId;        // null = modo R2
    private final PrivateKey privateKey;   // null = modo R2

    /**
     * Modo R2: construtor sem chave RSA.
     * Usa o AmazonS3 client existente para gerar pre-signed URLs HMAC.
     * Substitui o endpoint interno pela cdnBaseUrl (custom domain).
     */
    public CdnArtifactUrlResolver(String cdnBaseUrl, int expirySec,
                                   AmazonS3 s3Client, String bucketName) {
        this.cdnBaseUrl = cdnBaseUrl;
        this.expirySec = expirySec;
        this.s3Client = s3Client;
        this.bucketName = bucketName;
        this.keyPairId = null;
        this.privateKey = null;
    }

    /**
     * Modo CloudFront: construtor com chave RSA.
     * Gera CloudFront Signed URLs com canned policy.
     */
    public CdnArtifactUrlResolver(String cdnBaseUrl, String keyPairId,
                                   String privateKeyPem, int expirySec) {
        this.cdnBaseUrl = cdnBaseUrl;
        this.keyPairId = keyPairId;
        this.privateKey = parsePemPrivateKey(privateKeyPem);
        this.expirySec = expirySec;
        this.s3Client = null;
        this.bucketName = null;
    }

    @Override
    public List<ArtifactUrl> getUrls(DownloadDescriptor descriptor, URI requestUri, ApiType api) {
        String path = descriptor.tenant() + "/" + descriptor.sha1();
        String url;

        if (keyPairId != null) {
            // Modo A: AWS CloudFront Signed URL (RSA)
            url = signCloudFrontUrl(cdnBaseUrl + "/" + path);
        } else {
            // Modo B: Cloudflare R2 Pre-signed URL (HMAC via S3 SDK)
            url = generateR2PresignedUrl(path);
        }

        return List.of(new ArtifactUrl("http", url));
    }

    // ── Modo A: CloudFront RSA ──────────────────────────────

    private String signCloudFrontUrl(String url) {
        long expires = (System.currentTimeMillis() / 1000) + expirySec;
        String policy = "{\"Statement\":[{\"Resource\":\"" + url
            + "\",\"Condition\":{\"DateLessThan\":{\"AWS:EpochTime\":"
            + expires + "}}}]}";

        try {
            Signature signer = Signature.getInstance("SHA1withRSA");
            signer.initSign(privateKey);
            signer.update(policy.getBytes("UTF-8"));
            String sig = Base64.getUrlEncoder().withoutPadding()
                .encodeToString(signer.sign());

            return url + "?Expires=" + expires
                + "&Signature=" + sig
                + "&Key-Pair-Id=" + keyPairId;
        } catch (Exception e) {
            throw new RuntimeException("CloudFront signing failed", e);
        }
    }

    // ── Modo B: R2 S3 HMAC ──────────────────────────────────

    private String generateR2PresignedUrl(String key) {
        Date expiration = new Date(System.currentTimeMillis() + (long) expirySec * 1000);

        // Gera pre-signed URL via S3 SDK (HMAC-SHA256, mesma lógica do S3)
        String presigned = s3Client.generatePresignedUrl(bucketName, key, expiration).toString();

        // Substitui endpoint interno pelo custom domain (CDN)
        // Ex: https://bucket.r2.cloudflarestorage.com/key?X-Amz-Signature=...
        //  → http://r2.seudominio.com/key?X-Amz-Signature=...
        if (presigned.contains("://")) {
            int pathStart = presigned.indexOf("/", presigned.indexOf("://") + 3);
            presigned = cdnBaseUrl + presigned.substring(pathStart);
        }

        return presigned;
    }

    // ── Util ────────────────────────────────────────────────

    private static PrivateKey parsePemPrivateKey(String pem) {
        String content = pem
            .replace("-----BEGIN RSA PRIVATE KEY-----", "")
            .replace("-----END RSA PRIVATE KEY-----", "")
            .replace("-----BEGIN PRIVATE KEY-----", "")
            .replace("-----END PRIVATE KEY-----", "")
            .replaceAll("\\s", "");
        try {
            byte[] der = Base64.getDecoder().decode(content);
            return KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(der));
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse RSA private key", e);
        }
    }
}
```

### Registro dos Beans na AutoConfiguration

```java
// S3ArtifactStorageAutoConfiguration.java — adicionar:

/**
 * Modo B: Cloudflare R2 — pre-signed URLs HMAC via S3 SDK.
 * Ativado quando cdn-base-url está preenchido MAS cdn-key-pair-id NÃO está.
 * Simplificado: sem CloudFront, sem RSA, sem chave privada.
 */
@Bean
@ConditionalOnProperty(prefix = "org.eclipse.hawkbit.artifact.s3", name = "cdn-base-url")
@ConditionalOnMissingBean(ArtifactUrlResolver.class)
public ArtifactUrlResolver r2ArtifactUrlResolver(
        AmazonS3 amazonS3, S3StorageProperties properties) {
    LOG.info("CDN Mode B (R2): base URL={}, HMAC signing via S3 SDK",
             properties.getCdnBaseUrl());
    return new CdnArtifactUrlResolver(
        properties.getCdnBaseUrl(),
        properties.getCdnExpirySec(),
        amazonS3,
        properties.getBucketName()
    );
}

/**
 * Modo A: AWS CloudFront — Signed URLs RSA.
 * Ativado quando cdn-key-pair-id está preenchido (indica CloudFront).
 */
@Bean
@ConditionalOnProperty(prefix = "org.eclipse.hawkbit.artifact.s3",
                       name = {"cdn-base-url", "cdn-key-pair-id"})
public ArtifactUrlResolver cloudFrontArtifactUrlResolver(S3StorageProperties props) {
    LOG.info("CDN Mode A (CloudFront): base URL={}, key pair ID={}, RSA signing",
             props.getCdnBaseUrl(), props.getCdnKeyPairId());
    String privateKeyPem;
    try {
        privateKeyPem = Files.readString(Path.of(props.getCdnPrivateKeyPath()));
    } catch (Exception e) {
        throw new RuntimeException("Failed to read CloudFront private key from: "
            + props.getCdnPrivateKeyPath(), e);
    }
    return new CdnArtifactUrlResolver(
        props.getCdnBaseUrl(), props.getCdnKeyPairId(), privateKeyPem, props.getCdnExpirySec()
    );
}
```

> **Importante:** A ordem dos beans importa. O `cloudFrontArtifactUrlResolver` (com `@ConditionalOnProperty` para AMBOS `cdn-base-url` e `cdn-key-pair-id`) tem precedência quando ambos existem. O `r2ArtifactUrlResolver` só ativa quando `cdn-key-pair-id` está ausente.

---

## 📦 Variáveis de Ambiente — Dois Cenários

### Cenário A: AWS S3 + CloudFront

```env
# hawkBit S3 storage (upload)
S3_ENDPOINT=
S3_REGION=sa-east-1
S3_ACCESS_KEY=AKIA...
S3_SECRET_KEY=...
S3_BUCKET=ninbus-artifacts
HAWKBIT_S3_ENABLED=true

# CDN download (CloudFront RSA)
HAWKBIT_CDN_BASE_URL=http://dxxxxxxxxxx.cloudfront.net
HAWKBIT_CDN_KEY_PAIR_ID=K123456789EXAMPLE
HAWKBIT_CDN_PRIVATE_KEY_PATH=/run/secrets/cf-private-key.pem
HAWKBIT_CDN_EXPIRY_SEC=3600
```

### Cenário B: Cloudflare R2 (simplificado)

```env
# hawkBit S3 storage (upload para R2)
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_ACCESS_KEY=<r2-access-key-id>
S3_SECRET_KEY=<r2-secret-access-key>
S3_BUCKET=ninbus-artifacts
HAWKBIT_S3_ENABLED=true

# CDN download (R2 HMAC — sem CloudFront, sem RSA)
HAWKBIT_CDN_BASE_URL=http://r2.seudominio.com
# CDN_KEY_PAIR_ID vazio = modo R2 automático (HMAC)
# CDN_PRIVATE_KEY_PATH não necessário
HAWKBIT_CDN_EXPIRY_SEC=3600
```

---

## 🔍 Avaliação das Mudanças Existentes (working tree)

### ❌ REVERTER (TypeScript — código morto do plano v1/v2)

| Arquivo | Ação |
|---|---|
| `src/common/config/s3.ts` (NOVO) | **DELETAR** |
| `src/common/s3/client.ts` (NOVO) | **DELETAR** |
| `src/common/s3/` (diretório) | **DELETAR** |
| `src/modules/artifacts/ddi-download-routes.ts` (NOVO) | **DELETAR** |
| `src/app.ts` — import + .use(ddiDownloadRoutes) | **REVERTER** |
| `src/common/config/env.ts` — 7 vars S3_PRESIGNED_* | **REVERTER** |
| `package.json` — @aws-sdk/client-s3 + s3-request-presigner | **REVERTER** |

### ⚠️ AJUSTAR (Java — adaptar do plano v1/v2 para v4)

| Arquivo | Ação |
|---|---|
| `S3ArtifactStorage.java` | **REMOVER** `generatePresignedUrl()` e imports |
| `S3StorageProperties.java` | **SUBSTITUIR** `presignedExpiryMinutes` por `cdnBaseUrl`, `cdnKeyPairId`, `cdnPrivateKeyPath`, `cdnExpirySec` |
| `S3ArtifactStorageAutoConfiguration.java` | **ADICIONAR** 2 beans (R2 + CloudFront) |

### ✅ MANTER (congruente)

| Arquivo | Ação |
|---|---|
| `docker-compose.yml` — remoção MinIO | **MANTER** |
| `docker-compose.yml` — S3 creds no hawkbit | **MANTER**, remover vars API, adicionar CDN vars ao hawkbit |
| `.env.example` — docs AWS/R2 | **MANTER**, trocar S3_PRESIGNED_* por HAWKBIT_CDN_* |
| `.env.test` | **MANTER**, simplificar |

### 🆕 CRIAR (novo)

| Arquivo | Ação |
|---|---|
| `CdnArtifactUrlResolver.java` | **CRIAR** (~100 linhas) |

---

## 📊 Resumo de Impacto Líquido

| Métrica | Remover | Adicionar |
|---|---|---|
| TypeScript linhas | ~335 | 0 |
| npm deps | 2 (~200KB) | 0 |
| Java linhas (líquido) | 25 | ~115 |
| Arquivos Java novos | 0 | 1 |
| Firmware STM32 | 0 | 0 |

---

## ✅ Critérios de Aceite

1. **Zero código TypeScript novo** — lógica toda no hawkBit Java
2. **Zero mudança no firmware STM32**
3. **`bun build` limpo** após remoções
4. **`docker compose build hawkbit` limpo**
5. **Modo A (CloudFront):** deploymentBase com `http://dxxx.cloudfront.net/...?Signature=...`
6. **Modo B (R2):** deploymentBase com `http://r2.seudominio.com/...?X-Amz-Signature=...`
7. **Sem CDN vars:** URLs padrão hawkBit (fallback automático)
8. **Decisão automática:** `CDN_KEY_PAIR_ID` vazio = R2, preenchido = CloudFront

---

*Aguardando aprovação para executar.*
