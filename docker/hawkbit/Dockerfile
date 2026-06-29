# ═══════════════════════════════════════════════════════════════════
# hawkBit Update Server — Custom build with S3 artifact storage
#
# Adds S3ArtifactStorage compiled against hawkBit 1.0.3 APIs.
# Only the S3 extension + AWS SDK JARs are added (+14MB over base).
#
# Storage backends (controlled by env vars):
#   Filesystem (default): /app/artifactrepo/ → Docker volume
#   S3:  Set HAWKBIT_S3_ENABLED=true
#        See .env.docker for full configuration
#
# Build: docker compose build hawkbit
# ═══════════════════════════════════════════════════════════════════

# ── Stage 1: Build S3 extension against hawkBit 1.0.3 ────────────
FROM maven:3.9-eclipse-temurin-21 AS builder

WORKDIR /build
COPY docker/hawkbit/s3-extension/ .

# Compile extension (hawkbit-artifact-api is "provided" scope — not bundled)
RUN mvn clean package -DskipTests --no-transfer-progress -q

# Download runtime deps into separate folder
RUN mvn dependency:copy-dependencies \
    -DoutputDirectory=/build/deps \
    -DincludeScope=runtime \
    --no-transfer-progress \
    -q

# List what we're adding (for debugging)
RUN echo "=== Extension JAR ===" && \
    ls /build/target/hawkbit-extension-*.jar && \
    echo "=== Runtime deps ===" && \
    ls /build/deps/

# ── Stage 2: Add only S3 extension + AWS SDK to base image ──────
FROM hawkbit/hawkbit-update-server:1.0.3

USER root

# Add only the S3 extension JAR
COPY --from=builder /build/target/hawkbit-extension-artifact-repository-s3-*.jar /tmp/s3-ext/

# Add AWS SDK deps (they don't conflict with base image)
COPY --from=builder /build/deps/ /tmp/s3-deps/

# Move only needed JARs into classpath (AWS SDK + extension), skip anything already in base
RUN cd /tmp/s3-deps && \
    for jar in *.jar; do \
        if [ ! -f "/app/BOOT-INF/lib/$jar" ]; then \
            cp "$jar" "/app/BOOT-INF/lib/"; \
        fi; \
    done && \
    cp /tmp/s3-ext/*.jar /app/BOOT-INF/lib/ && \
    rm -rf /tmp/s3-deps /tmp/s3-ext

USER hawkbit
