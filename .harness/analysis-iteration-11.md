# Iteration 11 Analysis

**Phase**: completed
**Date**: 2026-04-29T03:56:34.039Z

## Results

### ✅ Functional Correctness

184/184 tests pass (1 new test added for artifact_provides.type fallback). Build clean. Artifact type resolution now correctly reads updates[0].type_info.type from Mender API response.

**Evidence**: bun build → 3.41 MB clean. bun test → 184 pass, 0 fail.

### ✅ Code Quality

All changed files under 250 lines: types.ts (137), service.ts (160), schemas.ts (143). client.ts is 349 lines (pre-existing, not changed in this iteration beyond resolveArtifactType — contains all Mender API functions + Ninbus constants). Clean separation maintained.

**Evidence**: wc -l shows all artifact module files under 250. client.ts was already 332+ lines before this iteration.

### ✅ Schema Organization

ArtifactUpdateSchema and ArtifactUpdateFileSchema added to schemas.ts with correct Mender fields (type_info.type, files[].name/checksum/size). ArtifactSchema updated with signed, updates, artifact_provides, artifact_depends, clears_artifact_provides. No response schemas defined in route files.

**Evidence**: schemas.ts exports all response + body schemas. Route files only import.

### ✅ Error Handling

resolveArtifactType() has fallback chain: updates[0].type_info.type → artifact_provides['type'] → null. No Mender errors leak to clients.

**Evidence**: client.ts resolveArtifactType has clear fallback logic with doc comments.

### ✅ Test Coverage

Added 1 new test for artifact_provides.type fallback. Updated 7 existing enrichment tests to use correct Mender format (updates[0].type_info.type instead of artifact.type). 58 artifact tests total, 184 overall.

**Evidence**: bun test tests/artifacts.test.ts → 58 pass, 0 fail. All enrichment tests use realistic Mender API data structures.

### ✅ Config Centralization

No config changes in this iteration. menderConfig remains thin accessor over env.ts.

**Evidence**: Zero process.env reads outside env.ts.

### ✅ Security

No security-relevant changes. Upload validation unchanged (extension .mender, size ≤500MB). PAT never exposed.

**Evidence**: File validation still requires .mender extension. PAT only in Authorization header.

### ✅ 🔮 Futuro (Aprendizado Contínuo)

Key discovery: Mender artifact type is in updates[0].type_info.type, NOT in a top-level 'type' field. The .mender file format (gzipped tar) is created by mender-artifact CLI — the server does NOT compress/convert raw files. Documented in code comments.

**Evidence**: New principle learned: p-mender-artifact-type-in-updates

## Overall Notes

## Iteration 11: Fix Artifact Type Resolution + Mender Upload Understanding

### Key Findings (answering user's questions)

**Q: Do I need to compress the file before uploading?**
**A: YES — you MUST create `.mender` files using `mender-artifact` CLI before uploading.** The Mender server does NOT convert raw files (.fir, .frz) into .mender format. The .mender format is a gzipped tar archive with a specific header structure that includes:
- `artifact_name` — the release name
- `device_types_compatible` — e.g., `ninbus-wifi-v3`
- `updates[].type_info.type` — the artifact TYPE (e.g., `firmware-ninbus`)
- The actual payload files

Use these commands at build time:
```bash
mender-artifact write module-image -T firmware-ninbus -o firmware.mender -n firmware-3.3.0 -t ninbus-wifi-v3 -f firmware.fir
mender-artifact write module-image -T firmware-controller -o controller.mender -n controller-12.6.0 -t ninbus-wifi-v3 -f controller.fir
mender-artifact write module-image -T configuration-nfx -o config.mender -n config-2026-04-14 -t ninbus-wifi-v3 -f nfx.frz
```

### Changes Made

**1. `types.ts` — MenderArtifact type updated with real Mender API fields**
- Added `MenderArtifactUpdate` interface with `type_info.type`
- Added `info`, `signed`, `updates`, `artifact_provides`, `artifact_depends`, `clears_artifact_provides`
- Removed non-existent top-level `type` field

**2. `client.ts` — resolveArtifactType() fixed**
- Primary: reads `updates[0].type_info.type` (the actual Mender API field)
- Fallback: reads `artifact_provides['type']` (v3 artifact provides)
- Clear doc comments explaining the chain

**3. `service.ts` — enrichArtifact() uses resolveArtifactType()**
- No longer reads non-existent `artifact.type`
- Delegates to `resolveArtifactType()` for correct extraction

**4. `schemas.ts` — ArtifactSchema updated to match Mender API**
- `ArtifactUpdateSchema` with `type_info: { type: string | null }`
- `ArtifactUpdateFileSchema` with `name`, `checksum`, `size`, `date`
- Full `ArtifactSchema` with all Mender response fields

**5. Tests updated**
- 7 enrichment tests use realistic Mender API data (updates[0].type_info.type)
- 1 new test for artifact_provides.type fallback
- Total: 58 artifact tests, 184 overall

### Upload Flow (no changes needed)
The upload flow is correct:
1. Build engineer creates `.mender` file with `mender-artifact` CLI
2. Upload via POST /api/companies/:companyId/artifacts (multipart/form-data)
3. API validates .mender extension + size, proxies to Mender Gateway
4. Mender parses artifact, extracts metadata including type_info.type
5. API returns enriched artifact with Ninbus type metadata
6. When deployed, the embedded device reads type_info.type and takes appropriate action