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

import com.amazonaws.ClientConfiguration;
import com.amazonaws.auth.AWSCredentials;
import com.amazonaws.auth.AWSCredentialsProvider;
import com.amazonaws.auth.AWSStaticCredentialsProvider;
import com.amazonaws.auth.DefaultAWSCredentialsProviderChain;
import com.amazonaws.client.builder.AwsClientBuilder.EndpointConfiguration;
import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.AmazonS3ClientBuilder;
import org.eclipse.hawkbit.artifact.ArtifactStorage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.util.StringUtils;

/**
 * Spring Boot auto-configuration that registers S3-based ArtifactStorage.
 *
 * Activated when org.eclipse.hawkbit.artifact.s3.enabled=true.
 * Overrides the default filesystem ArtifactStorage via @ConditionalOnMissingBean
 * on the filesystem configuration.
 *
 * Configuration:
 *   org.eclipse.hawkbit.artifact.s3.bucket-name  — S3 bucket name
 *   org.eclipse.hawkbit.artifact.s3.endpoint      — S3 endpoint (SeaweedFS, MinIO, R2)
 *   org.eclipse.hawkbit.artifact.s3.region         — AWS region (optional)
 *   org.eclipse.hawkbit.artifact.s3.access-key     — Access key (or use AWS_ACCESS_KEY_ID env)
 *   org.eclipse.hawkbit.artifact.s3.secret-key     — Secret key (or use AWS_SECRET_ACCESS_KEY env)
 */
@Configuration
@ConditionalOnProperty(prefix = "org.eclipse.hawkbit.artifact.s3", name = "enabled", havingValue = "true")
@EnableConfigurationProperties(S3StorageProperties.class)
public class S3ArtifactStorageAutoConfiguration {

    private static final Logger LOG = LoggerFactory.getLogger(S3ArtifactStorageAutoConfiguration.class);

    @Bean
    public AmazonS3 amazonS3(final S3StorageProperties properties) {
        final AmazonS3ClientBuilder builder = AmazonS3ClientBuilder.standard()
                .withClientConfiguration(new ClientConfiguration());

        // Credentials: explicit > anonymous (S3-compatible: SeaweedFS, MinIO)
        // For AWS S3 / Cloudflare R2, always set access-key + secret-key
        final AWSCredentialsProvider credentialsProvider;
        if (StringUtils.hasLength(properties.getAccessKey())) {
            credentialsProvider = new AWSStaticCredentialsProvider(
                    new AWSCredentials() {
                        @Override public String getAWSAccessKeyId() { return properties.getAccessKey(); }
                        @Override public String getAWSSecretKey() { return properties.getSecretKey(); }
                    });
        } else if (StringUtils.hasLength(properties.getEndpoint())) {
            // S3-compatible services (SeaweedFS standard IAM) — anonymous access
            credentialsProvider = new AWSStaticCredentialsProvider(
                    new AWSCredentials() {
                        @Override public String getAWSAccessKeyId() { return ""; }
                        @Override public String getAWSSecretKey() { return ""; }
                    });
            LOG.info("S3 artifact storage: using anonymous credentials (no access-key configured)");
        } else {
            // AWS S3 with IAM role / env vars
            credentialsProvider = new DefaultAWSCredentialsProviderChain();
        }
        builder.withCredentials(credentialsProvider);

        // Custom endpoint (SeaweedFS, MinIO, Cloudflare R2)
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

    @Bean
    public ArtifactStorage artifactStorage(final AmazonS3 amazonS3, final S3StorageProperties properties) {
        LOG.info("Using S3 artifact storage (bucket: {})", properties.getBucketName());

        // Ensure bucket exists (non-fatal — bucket may be pre-created)
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
}
