/**
 * Copyright (c) 2025 Contributors to the Eclipse Foundation
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0
 *
 * SPDX-License-Identifier: EPL-2.0
 */
package org.eclipse.hawkbit.artifact.s3;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * S3 artifact storage configuration properties.
 *
 * Bucket:       org.eclipse.hawkbit.artifact.s3.bucket-name
 * Endpoint:     aws.s3.endpoint (e.g. http://seaweedfs:8333)
 * Credentials:  AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY env vars
 */
@ConfigurationProperties("org.eclipse.hawkbit.artifact.s3")
public class S3StorageProperties {

    private String bucketName = "artifactrepository";
    private String endpoint;
    private String region;
    private String accessKey;
    private String secretKey;

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
}
