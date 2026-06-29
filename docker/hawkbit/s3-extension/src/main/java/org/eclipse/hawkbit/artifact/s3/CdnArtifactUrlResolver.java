/**
 * Copyright (c) 2025 Contributors to the Eclipse Foundation
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 */
package org.eclipse.hawkbit.artifact.s3;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Base64;
import java.util.Date;
import java.util.List;

import com.amazonaws.services.s3.AmazonS3;
import org.eclipse.hawkbit.artifact.urlresolver.ArtifactUrl;
import org.eclipse.hawkbit.artifact.urlresolver.ArtifactUrlResolver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * CDN-aware {@link ArtifactUrlResolver} that generates signed download URLs
 * pointing to a CDN (CloudFront or R2 custom domain) instead of hawkBit.
 *
 * <p>Two modes, selected automatically by configuration:
 *
 * <ul>
 *   <li><b>Mode A (AWS CloudFront):</b> RSA Signed URLs — activated when
 *       {@code cdnKeyPairId} is set. Requires CloudFront Distribution + Key Pair.</li>
 *   <li><b>Mode B (Cloudflare R2):</b> HMAC Pre-signed URLs via S3 SDK —
 *       activated when {@code cdnBaseUrl} is set but {@code cdnKeyPairId} is empty.
 *       Uses the existing AmazonS3 client; replaces internal endpoint with custom domain.
 *       Zero extra infra needed.</li>
 * </ul>
 *
 * <p>When no CDN is configured, this bean is not registered and hawkBit's
 * default {@code PropertyBasedArtifactUrlResolver} is used (URLs point to hawkBit).
 *
 * <p>The STM32 device follows these URLs from the deploymentBase JSON —
 * it does not know whether it downloads from hawkBit, CloudFront, or R2.
 */
public class CdnArtifactUrlResolver implements ArtifactUrlResolver {

    private static final Logger LOG = LoggerFactory.getLogger(CdnArtifactUrlResolver.class);

    private final String cdnBaseUrl;
    private final int expirySec;

    // Mode B (R2): reuse existing S3 client for HMAC signing
    private final AmazonS3 s3Client;
    private final String bucketName;

    // Mode A (CloudFront): RSA signing
    private final String keyPairId;
    private final PrivateKey privateKey;

    // ── Constructor: Mode B (R2) ──────────────────────────────

    /**
     * Create resolver for Mode B (Cloudflare R2).
     * Reuses the existing AmazonS3 client to generate HMAC pre-signed URLs,
     * then replaces the internal S3 endpoint with the CDN custom domain.
     *
     * @param cdnBaseUrl  R2 custom domain URL (e.g. http://r2.seudominio.com)
     * @param expirySec   URL expiry in seconds
     * @param s3Client    Existing AmazonS3 client (configured for R2 endpoint)
     * @param bucketName  S3/R2 bucket name
     */
    public CdnArtifactUrlResolver(final String cdnBaseUrl, final int expirySec,
                                   final AmazonS3 s3Client, final String bucketName) {
        this.cdnBaseUrl = cdnBaseUrl;
        this.expirySec = expirySec;
        this.s3Client = s3Client;
        this.bucketName = bucketName;
        this.keyPairId = null;
        this.privateKey = null;
        LOG.info("[CDN] Mode B (R2 HMAC): baseUrl={}, bucket={}, expiry={}s",
                cdnBaseUrl, bucketName, expirySec);
    }

    // ── Constructor: Mode A (CloudFront) ──────────────────────

    /**
     * Create resolver for Mode A (AWS CloudFront).
     * Generates CloudFront Signed URLs using RSA (canned policy).
     *
     * @param cdnBaseUrl       CloudFront URL (e.g. http://dxxx.cloudfront.net)
     * @param keyPairId        CloudFront Key Pair ID
     * @param privateKeyPem    RSA private key in PEM format
     * @param expirySec        URL expiry in seconds
     */
    public CdnArtifactUrlResolver(final String cdnBaseUrl, final String keyPairId,
                                   final String privateKeyPem, final int expirySec) {
        this.cdnBaseUrl = cdnBaseUrl;
        this.keyPairId = keyPairId;
        this.privateKey = parsePemPrivateKey(privateKeyPem);
        this.expirySec = expirySec;
        this.s3Client = null;
        this.bucketName = null;
        LOG.info("[CDN] Mode A (CloudFront RSA): baseUrl={}, keyPairId={}, expiry={}s",
                cdnBaseUrl, keyPairId, expirySec);
    }

    // ── ArtifactUrlResolver interface ─────────────────────────

    @Override
    public List<ArtifactUrl> getUrls(final DownloadDescriptor descriptor,
                                      final ApiType api) {
        return resolveUrls(descriptor);
    }

    @Override
    public List<ArtifactUrl> getUrls(final DownloadDescriptor descriptor,
                                      final ApiType api, final URI requestUri) {
        return resolveUrls(descriptor);
    }

    private List<ArtifactUrl> resolveUrls(final DownloadDescriptor descriptor) {
        final String path = descriptor.tenant() + "/" + descriptor.sha1();
        final String url;

        if (keyPairId != null) {
            // Mode A: CloudFront RSA Signed URL
            url = signCloudFrontUrl(cdnBaseUrl + "/" + path);
        } else {
            // Mode B: R2 HMAC Pre-signed URL
            url = generateR2PresignedUrl(path);
        }

        LOG.debug("[CDN] Generated URL for {}/{}: {}", descriptor.tenant(),
                descriptor.sha1(), url);

        // ArtifactUrl(protocol, rel, ref) — record with 3 fields
        // protocol = URL scheme, rel = link relation, ref = the actual URL
        return List.of(new ArtifactUrl("http", "download-http", url));
    }

    // ── Mode A: CloudFront RSA Signing ────────────────────────

    private String signCloudFrontUrl(final String url) {
        final long expires = (System.currentTimeMillis() / 1000) + expirySec;

        // CloudFront canned policy: {"Statement":[{"Resource":"<url>","Condition":{"DateLessThan":{"AWS:EpochTime":<ts>}}}]}
        final String policy = "{\"Statement\":[{\"Resource\":\"" + url
                + "\",\"Condition\":{\"DateLessThan\":{\"AWS:EpochTime\":"
                + expires + "}}}]}";

        try {
            final Signature signer = Signature.getInstance("SHA1withRSA");
            signer.initSign(privateKey);
            signer.update(policy.getBytes(StandardCharsets.UTF_8));
            final byte[] signature = signer.sign();

            final String encodedSig = Base64.getUrlEncoder()
                    .withoutPadding()
                    .encodeToString(signature);

            return url + "?Expires=" + expires
                    + "&Signature=" + encodedSig
                    + "&Key-Pair-Id=" + keyPairId;
        } catch (final Exception e) {
            throw new RuntimeException("CloudFront URL signing failed for: " + url, e);
        }
    }

    // ── Mode B: R2 HMAC Pre-signed ────────────────────────────

    private String generateR2PresignedUrl(final String key) {
        final Date expiration = new Date(System.currentTimeMillis() + (long) expirySec * 1000);

        // Generate standard S3 pre-signed URL (HMAC-SHA256) via SDK
        final String presigned = s3Client.generatePresignedUrl(bucketName, key, expiration).toString();

        // Replace internal S3/R2 endpoint with the public custom domain.
        // Before: https://bucket.r2.cloudflarestorage.com/DEFAULT/sha1?X-Amz-Signature=...
        // After:  http://r2.seudominio.com/DEFAULT/sha1?X-Amz-Signature=...
        final int schemeEnd = presigned.indexOf("://");
        if (schemeEnd > 0) {
            final int pathStart = presigned.indexOf("/", schemeEnd + 3);
            if (pathStart > 0) {
                return cdnBaseUrl + presigned.substring(pathStart);
            }
        }

        // Fallback: return as-is if URL structure unexpected
        LOG.warn("[CDN] Could not replace endpoint in pre-signed URL, returning original");
        return presigned;
    }

    // ── PEM Parser ────────────────────────────────────────────

    private static PrivateKey parsePemPrivateKey(final String pem) {
        final String content = pem
                .replace("-----BEGIN RSA PRIVATE KEY-----", "")
                .replace("-----END RSA PRIVATE KEY-----", "")
                .replace("-----BEGIN PRIVATE KEY-----", "")
                .replace("-----END PRIVATE KEY-----", "")
                .replaceAll("\\s", "");
        try {
            final byte[] der = Base64.getDecoder().decode(content);
            return KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(der));
        } catch (final Exception e) {
            throw new RuntimeException("Failed to parse CloudFront RSA private key. " +
                    "Ensure the PEM is valid PKCS#8 or PKCS#1 format.", e);
        }
    }
}
