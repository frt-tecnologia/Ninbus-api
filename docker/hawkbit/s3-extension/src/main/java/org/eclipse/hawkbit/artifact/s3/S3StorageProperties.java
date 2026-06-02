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

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * S3 artifact storage configuration properties.
 *
 * Storage (upload):
 *   org.eclipse.hawkbit.artifact.s3.bucket-name
 *   org.eclipse.hawkbit.artifact.s3.endpoint
 *   org.eclipse.hawkbit.artifact.s3.region
 *   org.eclipse.hawkbit.artifact.s3.access-key
 *   org.eclipse.hawkbit.artifact.s3.secret-key
 *
 * CDN download (two modes):
 *   Mode A (AWS CloudFront): set cdn-base-url + cdn-key-pair-id + cdn-private-key-path
 *     → RSA Signed URLs
 *   Mode B (Cloudflare R2):  set cdn-base-url only (no key-pair-id)
 *     → HMAC Pre-signed URLs via S3 SDK, endpoint replaced by custom domain
 *   No CDN:                   leave cdn-base-url empty
 *     → hawkBit serves artifacts directly (default behavior)
 */
@ConfigurationProperties("org.eclipse.hawkbit.artifact.s3")
public class S3StorageProperties {

    // ── S3 Storage (upload) ────────────────────────────────────

    private String bucketName = "artifactrepository";
    private String endpoint;
    private String region;
    private String accessKey;
    private String secretKey;

    // ── CDN Download ───────────────────────────────────────────

    /** CDN base URL. When set, artifact download URLs point here instead of hawkBit.
     *  CloudFront: http://dxxxxxxxxxx.cloudfront.net
     *  R2 custom domain: http://r2.seudominio.com */
    private String cdnBaseUrl;

    /** CloudFront Key Pair ID. When set → Mode A (RSA signing).
     *  When empty + cdnBaseUrl set → Mode B (R2 HMAC signing). */
    private String cdnKeyPairId;

    /** Path to CloudFront private key PEM file (Mode A only).
     *  Prefer file mount (Secrets Manager) over env var for security. */
    private String cdnPrivateKeyPath;

    /** Signed URL expiry in seconds (default 1h). */
    private int cdnExpirySec = 3600;

    // ── S3 Storage getters/setters ─────────────────────────────

    public String getBucketName() { return bucketName; }
    public void setBucketName(final String bucketName) { this.bucketName = bucketName; }

    public String getEndpoint() { return endpoint; }
    public void setEndpoint(final String endpoint) { this.endpoint = endpoint; }

    public String getRegion() { return region; }
    public void setRegion(final String region) { this.region = region; }

    public String getAccessKey() { return accessKey; }
    public void setAccessKey(final String accessKey) { this.accessKey = accessKey; }

    public String getSecretKey() { return secretKey; }
    public void setSecretKey(final String secretKey) { this.secretKey = secretKey; }

    // ── CDN getters/setters ────────────────────────────────────

    public String getCdnBaseUrl() { return cdnBaseUrl; }
    public void setCdnBaseUrl(final String cdnBaseUrl) { this.cdnBaseUrl = cdnBaseUrl; }

    public String getCdnKeyPairId() { return cdnKeyPairId; }
    public void setCdnKeyPairId(final String cdnKeyPairId) { this.cdnKeyPairId = cdnKeyPairId; }

    public String getCdnPrivateKeyPath() { return cdnPrivateKeyPath; }
    public void setCdnPrivateKeyPath(final String cdnPrivateKeyPath) { this.cdnPrivateKeyPath = cdnPrivateKeyPath; }

    public int getCdnExpirySec() { return cdnExpirySec; }
    public void setCdnExpirySec(final int cdnExpirySec) { this.cdnExpirySec = cdnExpirySec; }
}
