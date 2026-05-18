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

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;

import org.eclipse.hawkbit.artifact.AbstractArtifactStorage;
import org.eclipse.hawkbit.artifact.exception.ArtifactStoreException;
import org.eclipse.hawkbit.artifact.model.ArtifactHashes;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.util.StringUtils;
import org.springframework.validation.annotation.Validated;

import com.amazonaws.AmazonClientException;
import com.amazonaws.ClientConfiguration;
import com.amazonaws.auth.AWSCredentials;
import com.amazonaws.auth.AWSCredentialsProvider;
import com.amazonaws.auth.AWSStaticCredentialsProvider;
import com.amazonaws.auth.DefaultAWSCredentialsProviderChain;
import com.amazonaws.client.builder.AwsClientBuilder.EndpointConfiguration;
import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.AmazonS3ClientBuilder;
import com.amazonaws.services.s3.model.DeleteObjectRequest;
import com.amazonaws.services.s3.model.ObjectListing;
import com.amazonaws.services.s3.model.ObjectMetadata;
import com.amazonaws.services.s3.model.PutObjectResult;
import com.amazonaws.services.s3.model.S3Object;
import com.amazonaws.services.s3.model.S3ObjectSummary;

/**
 * {@link org.eclipse.hawkbit.artifact.ArtifactStorage} implementation for
 * S3-compatible services (AWS S3, SeaweedFS, MinIO, Cloudflare R2).
 *
 * All binaries are stored in a single bucket, keyed by: {TENANT}/{sha1}
 */
@Validated
public class S3ArtifactStorage extends AbstractArtifactStorage {

    private static final Logger LOG = LoggerFactory.getLogger(S3ArtifactStorage.class);

    private final AmazonS3 amazonS3;
    private final S3StorageProperties properties;

    public S3ArtifactStorage(final AmazonS3 amazonS3, final S3StorageProperties properties) {
        this.amazonS3 = amazonS3;
        this.properties = properties;
    }

    @Override
    public InputStream getBySha1(final String tenant, final String sha1Hash) {
        final String key = objectKey(tenant, sha1Hash);
        try {
            final S3Object s3Object = amazonS3.getObject(properties.getBucketName(), key);
            if (s3Object == null) {
                return null;
            }

            // Read the entire S3 object into memory before returning.
            // This prevents the "Not all bytes were read from S3ObjectInputStream, aborting"
            // WARN that occurs when hawkBit's DDI response stream is closed before the
            // S3 stream is fully consumed (device finishes download → HTTP connection closes
            // → S3 stream has remaining bytes → AWS SDK aborts the connection).
            //
            // For firmware artifacts (< 50MB), this is fine and eliminates the
            // connection abort overhead that slows down sequential downloads.
            try (S3Object obj = s3Object) {
                final InputStream content = obj.getObjectContent();
                final byte[] bytes = content.readAllBytes();
                LOG.debug("Loaded S3 artifact {}/{} ({} bytes) into memory",
                        properties.getBucketName(), key, bytes.length);
                return new java.io.ByteArrayInputStream(bytes);
            }
        } catch (final AmazonClientException e) {
            LOG.error("Could not retrieve S3 object {}/{}", properties.getBucketName(), key, e);
            return null;
        } catch (final IOException e) {
            LOG.error("Failed to read S3 object {}/{}", properties.getBucketName(), key, e);
            return null;
        }
    }

    @Override
    public boolean existsBySha1(final String tenant, final String sha1Hash) {
        return amazonS3.doesObjectExist(properties.getBucketName(), objectKey(tenant, sha1Hash));
    }

    @Override
    public void deleteBySha1(final String tenant, final String sha1Hash) {
        final String key = objectKey(tenant, sha1Hash);
        LOG.info("Deleting S3 object from bucket {} key {}", properties.getBucketName(), key);
        amazonS3.deleteObject(new DeleteObjectRequest(properties.getBucketName(), key));
    }

    @Override
    public void deleteByTenant(final String tenant) {
        final String prefix = sanitizeTenant(tenant) + "/";
        LOG.info("Deleting all S3 objects in bucket {} with prefix {}",
                properties.getBucketName(), prefix);

        ObjectListing listing = amazonS3.listObjects(properties.getBucketName(), prefix);
        do {
            for (final S3ObjectSummary summary : listing.getObjectSummaries()) {
                amazonS3.deleteObject(properties.getBucketName(), summary.getKey());
            }
            listing = amazonS3.listNextBatchOfObjects(listing);
        } while (listing.isTruncated());
    }

    @Override
    protected void store(final String tenant, final ArtifactHashes hashes,
                         final String contentType, final File tempFile) throws IOException {
        final String key = objectKey(tenant, hashes.sha1());

        LOG.info("Storing artifact ({} bytes) to S3 bucket {} key {}",
                tempFile.length(), properties.getBucketName(), key);

        if (existsBySha1(tenant, hashes.sha1())) {
            LOG.debug("Artifact {} already exists in S3, skipping upload", key);
            return;
        }

        final ObjectMetadata metadata = new ObjectMetadata();
        metadata.setContentLength(tempFile.length());
        if (contentType != null) {
            metadata.setContentType(contentType);
        }

        try (final InputStream is = new BufferedInputStream(new FileInputStream(tempFile))) {
            final PutObjectResult result = amazonS3.putObject(
                    properties.getBucketName(), key, is, metadata);
            LOG.debug("Stored S3 object {} (ETag: {})", key, result.getETag());
        } catch (final AmazonClientException e) {
            throw new ArtifactStoreException("Failed to store artifact in S3: " + key, e);
        }
    }

    private String objectKey(final String tenant, final String sha1Hash) {
        return sanitizeTenant(tenant) + "/" + sha1Hash;
    }
}
