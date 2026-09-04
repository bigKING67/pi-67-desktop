export function assertArtifactSafe(value, secrets = {}) {
  const serialized = JSON.stringify(value);
  for (const secret of Object.values(secrets).filter(Boolean)) {
    if (serialized.includes(secret)) throw pilotArtifactError("credential_in_artifact");
  }
  if (/Bearer\s+[A-Za-z0-9._~-]+|ark-[a-z0-9-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/iu.test(serialized)) {
    throw pilotArtifactError("credential_shape_in_artifact");
  }
  if (/"(?:prompt|answer|response|content)"\s*:/iu.test(serialized)) {
    throw pilotArtifactError("raw_model_content_in_artifact");
  }
}

function pilotArtifactError(code) {
  return Object.assign(new Error(code), { code });
}
