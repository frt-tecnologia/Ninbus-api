# ✉️ Mensagem para o time Flutter — App Links / Universal Links do Ninbus

> **Encaminhar para o desenvolvedor Flutter.** Resumo do que mudou na API e do que o
> app precisa fazer para os links de e-mail abrirem direto no app.

---

Olá! Houve uma mudança no backend que afeta como os links de **reset de senha** e
**verificação de e-mail** chegam no app. Precisamos de configuração no app Flutter
para eles abrirem direto (App Link / Universal Link).

## O que mudou na API

Antes, os e-mails geravam links com **custom scheme**:
```
ninbus://reset-password?token=XXX
ninbus://verify-email?token=XXX
```
Esse formato **não era clicável dentro dos apps de e-mail no mobile** (Gmail/Outlook/Yahoo
removem o link por segurança — anti-phishing). Por isso o usuário não conseguia tocar.

Agora os links são **HTTPS App Links** (clicáveis em qualquer cliente de e-mail):
```
https://ninbus.frt.com.br/reset-password?token=XXX
https://ninbus.frt.com.br/verify-email?token=XXX
```
Quando o app está instalado e o domínio verificado, o toque abre o **app direto**
(sem passar pelo navegador). É o mesmo padrão do WhatsApp/Instagram/bancos.

## O que precisamos do app (2 plataformas)

### 1) Tratar as duas URLs no app
O app deve capturar o deep link, extrair o `token` do query string e abrir a tela certa:
- `https://ninbus.frt.com.br/reset-password?token=XXX` → tela de redefinição de senha
- `https://ninbus.frt.com.br/verify-email?token=XXX` → confirmação de e-mail verificado

(Pacotes úteis: `app_links` ou `uni_links` no pub.dev.)

### 2) Android — `AndroidManifest.xml`
Adicionar um `intent-filter` com `autoVerify="true"` para o host
`ninbus.frt.com.br` e os 2 paths:

```xml
<activity ...>
  <intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="https"
          android:host="ninbus.frt.com.br"
          android:pathPrefix="/reset-password" />
    <data android:scheme="https"
          android:host="ninbus.frt.com.br"
          android:pathPrefix="/verify-email" />
  </intent-filter>
</activity>
```

### 3) iOS — Associated Domains
Em `ios/Runner/Info.plist` ou via Xcode (Signing & Capabilities → Associated Domains):
```
applinks:ninbus.frt.com.br
```

## O que precisamos que vocês nos devolvam (para a TI configurar o servidor)

O Android e o iOS exigem que o servidor prove que "conhece" o app. Precisamos que
vocês nos passem estes valores para preencher 2 arquivos JSON que a TI vai publicar
em `https://ninbus.frt.com.br/.well-known/`:

1. **Android (`assetlinks.json`):**
   - `package_name` do app (ex.: `br.com.frt.ninbus`).
   - `sha256_cert_fingerprints`: o **fingerprint SHA-256 da App Signing Key** do Google
     Play Console (App integrity), **não** a chave de debug local. Pode ser mais de um.
2. **iOS (`apple-app-site-association`):**
   - **Team ID** (10 caracteres, ex.: `A1B2C3D4E5`) do Apple Developer.
   - **Bundle ID** (ex.: `br.com.frt.ninbus`).

(Como descobrir o fingerprint SHA-256:
`keytool -list -v -keystore release.jks -alias <alias>` ou direto no Play Console →
Test and release → Setup → App integrity.)

## Sequenciamento (importante)

O **release do app** com esses filtros deve ser publicado **antes** (ou no mesmo dia)
da ativação em produção — senão, até o app ser atualizado, o link vai abrir no
navegador (que redireciona para a loja) em vez do app.

Dúvidas sobre os paths/tokens, me chamem. O tutorial completo de servidor está em
`docs/email-app-link-aws-setup.md` (com a TI) caso precisem alinhar.
