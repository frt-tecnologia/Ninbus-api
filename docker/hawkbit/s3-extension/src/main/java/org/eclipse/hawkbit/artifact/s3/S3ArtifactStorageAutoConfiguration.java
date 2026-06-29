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

import java.nio.file.Files;
import java.nio.file.Path;

import com.amazonaws.ClientConfiguration;
import com.amazonaws.auth.AWSCredentials;
import com.amazonaws.auth.AWSCredentialsProvider;
import com.amazonaws.auth.AWSStaticCredentialsProvider;
import com.amazonaws.auth.DefaultAWSCredentialsProviderChain;
import com.amazonaws.client.builder.AwsClientBuilder.EndpointConfiguration;
import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.AmazonS3ClientBuilder;
import org.eclipse.hawkbit.artifact.ArtifactStorage;
import org.eclipse.hawkbit.artifact.urlresolver.ArtifactUrlResolver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.util.StringUtils;

/**
 * Spring Boot auto-configuration for S3 artifact storage + CDN URL resolution.
 *
 * <p>Storage: activated when {@code org.eclipse.hawkbit.artifact.s3.enabled=true}.
 * Overrides the default filesystem ArtifactStorage.
 *
 * <p>CDN download (optional): activated when {@code cdn-base-url} is set.
 * Two modes:
 * <ul>
 *   <li>Mode A (CloudFront RSA): cdn-key-pair-id is set</li>
 *   <li>Mode B (R2 HMAC): cdn-key-pair-id is empty</li>
 * </ul>
 * When no CDN is configured, hawkBit's default URL resolver is used.
 */
@Configuration
@ConditionalOnProperty(prefix = "org.eclipse.hawkbit.artifact.s3", name = "enabled", havingValue = "true")
@EnableConfigurationProperties(S3StorageProperties.class)
public class S3ArtifactStorageAutoConfiguration {

    private static final Logger LOG = LoggerFactory.getLogger(S3ArtifactStorageAutoConfiguration.class);

    // ── S3 Client ─────────────────────────────────────────────

    @Bean
    public AmazonS3 amazonS3(final S3StorageProperties properties) {
        final AmazonS3ClientBuilder builder = AmazonS3ClientBuilder.standard()
                .withClientConfiguration(new ClientConfiguration());

        final AWSCredentialsProvider credentialsProvider;
        if (StringUtils.hasLength(properties.getAccessKey())) {
            credentialsProvider = new AWSStaticCredentialsProvider(
                    new AWSCredentials() {
                        @Override public String getAWSAccessKeyId() { return properties.getAccessKey(); }
                        @Override public String getAWSSecretKey() { return properties.getSecretKey(); }
                    });
        } else if (StringUtils.hasLength(properties.getEndpoint())) {
            credentialsProvider = new AWSStaticCredentialsProvider(
                    new AWSCredentials() {
                        @Override public String getAWSAccessKeyId() { return ""; }
                        @Override public String getAWSSecretKey() { return ""; }
                    });
            LOG.info("S3 artifact storage: using anonymous credentials (no access-key configured)");
        } else {
            credentialsProvider = new DefaultAWSCredentialsProviderChain();
        }
        builder.withCredentials(credentialsProvider);

        if (StringUtils.hasLength(properties.getEndpoint())) {
            final String region = StringUtils.hasLength(properties.getRegion())
                    ? properties.getRegion() : "";
            builder.withEndpointConfiguration(
                    new EndpointConfiguration(properties.getEndpoint(), region))
                    .withPathStyleAccessEnabled(true);
            LOG.info("S3 artifact storage: endpoint={}, bucket={}, pathStyle=true",
                    properties.getEndpoint(), properties.getBucketName());
        } else if (StringUtils.hasLength(properties.getRegion())) {
            builder.withRegion(properties.getRegion());
            LOG.info("S3 artifact storage: region={}, bucket={}",
                    properties.getRegion(), properties.getBucketName());
        }

        return builder.build();
    }

    // ── Artifact Storage ──────────────────────────────────────

    @Bean
    public ArtifactStorage artifactStorage(final AmazonS3 amazonS3, final S3StorageProperties properties) {
        LOG.info("Using S3 artifact storage (bucket: {})", properties.getBucketName());

        try {
            if (!amazonS3.doesBucketExistV2(properties.getBucketName())) {
                amazonS3.createBucket(properties.getBucketName());
                LOG.info("Created S3 bucket: {}", properties.getBucketName());
            }
        } catch (final Exception e) {
            LOG.warn("Could not verify/create S3 bucket '{}': {}", properties.getBucketName(), e.getMessage());
            LOG.warn("Ensure the bucket exists before uploading artifacts");
        }

        return new S3ArtifactStorage(amazonS3, properties);
    }

    // ── CDN URL Resolvers ─────────────────────────────────────

    /**
     * Mode A (AWS CloudFront): RSA Signed URLs.
     * Activated when both cdn-base-url AND cdn-key-pair-id are set.
     * Takes priority over Mode B when both conditions are met.
     */
    @Bean
    @ConditionalOnProperty(prefix = "org.eclipse.hawkbit.artifact.s3",
            name = {"cdn-base-url", "cdn-key-pair-id"})
    public ArtifactUrlResolver cloudFrontArtifactUrlResolver(final S3StorageProperties props) {
        LOG.info("[CDN] Mode A (CloudFront RSA): baseUrl={}, keyPairId={}, expiry={}s",
                props.getCdnBaseUrl(), props.getCdnKeyPairId(), props.getCdnExpirySec());

        final String privateKeyPem;
        try {
            privateKeyPem = Files.readString(Path.of(props.getCdnPrivateKeyPath()));
        } catch (final Exception e) {
            throw new RuntimeException(
                    "Failed to read CloudFront private key from: " + props.getCdnPrivateKeyPath(), e);
        }

        return new CdnArtifactUrlResolver(
                props.getCdnBaseUrl(), props.getCdnKeyPairId(), privateKeyPem, props.getCdnExpirySec());
    }

    /**
     * Mode B (Cloudflare R2): HMAC Pre-signed URLs via S3 SDK.
     * Activated when cdn-base-url is set but cdn-key-pair-id is NOT set.
     * Uses the existing AmazonS3 client — zero extra infra needed.
     */
    @Bean
    @ConditionalOnProperty(prefix = "org.eclipse.hawkbit.artifact.s3", name = "cdn-base-url")
    @ConditionalOnMissingBean(ArtifactUrlResolver.class)
    public ArtifactUrlResolver r2ArtifactUrlResolver(
            final AmazonS3 amazonS3, final S3StorageProperties properties) {
        LOG.info("[CDN] Mode B (R2 HMAC): baseUrl={}, bucket={}, expiry={}s",
                properties.getCdnBaseUrl(), properties.getBucketName(), properties.getCdnExpirySec());

        return new CdnArtifactUrlResolver(
                properties.getCdnBaseUrl(), properties.getCdnExpirySec(),
                amazonS3, properties.getBucketName());
    }
}
