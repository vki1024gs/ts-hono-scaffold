const exactKeys = (value, expected, location, errors, required = expected) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${location}: expected an object`);
    return false;
  }
  const allowed = new Set(expected);
  for (const key of Object.keys(value))
    if (!allowed.has(key)) errors.push(`${location}: unknown field ${key}`);
  for (const key of required)
    if (!(key in value)) errors.push(`${location}: missing field ${key}`);
  return true;
};

const nonEmptyString = (value) =>
  typeof value === 'string' && value.trim().length > 0;

export function validateServiceManifest(manifest, packageJson) {
  const errors = [];
  if (
    !exactKeys(
      manifest,
      ['schemaVersion', 'identity', 'runtime', 'health', 'open', 'endpoints'],
      'manifest',
      errors,
      ['schemaVersion', 'identity', 'runtime', 'health', 'open', 'endpoints'],
    )
  )
    return errors;
  if (manifest.schemaVersion !== 1)
    errors.push('manifest.schemaVersion: unsupported version');

  if (
    exactKeys(
      manifest.identity,
      ['nameFrom', 'versionFrom'],
      'manifest.identity',
      errors,
    )
  ) {
    if (manifest.identity.nameFrom !== 'package.json#name')
      errors.push('manifest.identity.nameFrom: unsupported reference');
    if (manifest.identity.versionFrom !== 'package.json#version')
      errors.push('manifest.identity.versionFrom: unsupported reference');
  }

  if (
    exactKeys(
      manifest.runtime,
      ['foregroundScript', 'managedScripts'],
      'manifest.runtime',
      errors,
    )
  ) {
    const scripts = [manifest.runtime.foregroundScript];
    if (
      exactKeys(
        manifest.runtime.managedScripts,
        ['start', 'stop', 'restart', 'status', 'logs'],
        'manifest.runtime.managedScripts',
        errors,
      )
    )
      scripts.push(...Object.values(manifest.runtime.managedScripts));
    for (const script of scripts)
      if (!nonEmptyString(script) || !packageJson.scripts?.[script])
        errors.push(`manifest.runtime: missing package script ${script}`);
  }

  const endpointIds = new Set();
  if (!Array.isArray(manifest.endpoints) || manifest.endpoints.length === 0)
    errors.push('manifest.endpoints: expected a non-empty array');
  else
    for (const [index, endpoint] of manifest.endpoints.entries()) {
      const location = `manifest.endpoints[${index}]`;
      if (
        !exactKeys(
          endpoint,
          ['id', 'label', 'scheme', 'hostEnv', 'portEnv'],
          location,
          errors,
        )
      )
        continue;
      for (const key of ['id', 'label', 'hostEnv', 'portEnv'])
        if (!nonEmptyString(endpoint[key]))
          errors.push(`${location}.${key}: expected a non-empty string`);
      if (endpoint.scheme !== 'http' && endpoint.scheme !== 'https')
        errors.push(`${location}.scheme: expected http or https`);
      if (endpointIds.has(endpoint.id))
        errors.push(`${location}.id: duplicate endpoint id ${endpoint.id}`);
      endpointIds.add(endpoint.id);
    }

  for (const [name, value] of [
    ['health', manifest.health],
    ['open', manifest.open],
  ])
    if (exactKeys(value, ['endpointId', 'path'], `manifest.${name}`, errors)) {
      if (!endpointIds.has(value.endpointId))
        errors.push(`manifest.${name}.endpointId: unknown endpoint`);
      if (!nonEmptyString(value.path) || !value.path.startsWith('/'))
        errors.push(`manifest.${name}.path: expected an absolute URL path`);
    }

  return errors;
}
