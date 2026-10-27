/**
 * Generate OpenAPI 3.0 + Postman collection from Express routes.
 *
 * Usage:
 *   npx tsx scripts/api-docs/generate.ts
 *   npm run docs:generate
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  exampleFor,
  fieldSchema,
  notes,
  requestExamples,
  requestSchema,
  type Schema,
} from './contracts';
import { getRoutes, inspect, type Route } from './source';
import { rraOpenApiSpec } from '../../src/docs/rra-openapi';

const backend = path.resolve(__dirname, '../..');
const outDir = path.join(backend, 'src/docs');
const postmanDir = path.resolve(backend, '../Postman');

function pathParams(routePath: string) {
  return [...routePath.matchAll(/:([A-Za-z0-9_]+)/g)].map(match => match[1]);
}

function openApiPath(routePath: string) {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function operationId(route: Route) {
  return `${route.method.toLowerCase()}_${route.path.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
}

function summary(route: Route) {
  const handler = route.handler.replace(/Controller$/i, '');
  const spaced = handler.replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function isAuthenticated(route: Route) {
  return route.middleware.some(text => /authenticate|requireSystemOwner/.test(text));
}

function roles(route: Route): string[] {
  for (const text of route.middleware) {
    const match = /authorize\(\s*((?:['"][^'"]+['"]\s*,?\s*)+)\)/.exec(text);
    if (match) return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1]);
  }
  return [];
}

function buildParameters(route: Route) {
  const inspected = inspect(route);
  const parameters: any[] = [];
  for (const name of pathParams(route.path)) {
    parameters.push({
      name,
      in: 'path',
      required: true,
      schema: fieldSchema(name, {}, route),
    });
  }
  for (const [name, supplied] of inspected.query) {
    parameters.push({
      name,
      in: 'query',
      required: supplied.default === undefined && !/optional|^\?/.test(name),
      schema: fieldSchema(name, supplied, route, true),
    });
  }
  return parameters;
}

function buildRequestBody(route: Route) {
  const schema = requestSchema(route);
  if (!schema) return undefined;
  const examples = requestExamples(route, schema);
  const contentType = route.upload ? 'multipart/form-data' : 'application/json';
  return {
    required: true,
    content: {
      [contentType]: {
        schema,
        examples,
      },
    },
  };
}

function buildResponses(route: Route) {
  const inspected = inspect(route);
  const responses: Record<string, any> = {};
  const statuses = Object.keys(inspected.responses);
  if (!statuses.length) {
    responses['200'] = {
      description: 'Successful response',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: { type: 'object', additionalProperties: true },
              message: { type: 'string' },
            },
          },
        },
      },
    };
  }
  for (const [status, payload] of Object.entries(inspected.responses)) {
    const description =
      status === '201' ? 'Created' :
      status === '202' ? 'Accepted / pending' :
      status === '204' ? 'No content' :
      status === '302' ? 'Redirect' :
      status === '400' ? 'Bad request' :
      status === '401' ? 'Unauthorized' :
      status === '403' ? 'Forbidden' :
      status === '404' ? 'Not found' :
      status === '425' ? 'Too early / pending fiscalization' :
      'Successful response';
    if (!payload.json) {
      responses[status] = {
        description,
        content: {
          [payload.mime || 'application/octet-stream']: {
            schema: payload.schema?.type ? payload.schema : { type: 'string', format: 'binary' },
          },
        },
      };
      continue;
    }
    responses[status] = {
      description,
      content: {
        'application/json': {
          schema: Object.keys(payload.schema || {}).length
            ? payload.schema
            : { type: 'object', additionalProperties: true },
        },
      },
    };
  }
  if (isAuthenticated(route)) {
    responses['401'] ||= {
      description: 'Missing or invalid JWT',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { type: 'string' },
            },
          },
        },
      },
    };
  }
  return responses;
}

function buildOperation(route: Route) {
  const roleList = roles(route);
  const descriptionParts = [
    notes[route.handler],
    roleList.length ? `Allowed roles: ${roleList.join(', ')}.` : undefined,
    `Handler: \`${route.handler}\` (\`${route.source}:${route.line}\`).`,
  ].filter(Boolean);

  return {
    tags: [route.tag],
    summary: summary(route),
    description: descriptionParts.join(' '),
    operationId: operationId(route),
    security: isAuthenticated(route) ? [{ bearerAuth: [] }] : [],
    parameters: buildParameters(route),
    ...(buildRequestBody(route) ? { requestBody: buildRequestBody(route) } : {}),
    responses: buildResponses(route),
  };
}

function buildOpenApi(routes: Route[]) {
  const paths: Record<string, any> = {};
  const tags = new Map<string, string>();

  for (const route of routes) {
    const key = openApiPath(route.path);
    paths[key] ||= {};
    paths[key][route.method.toLowerCase()] = buildOperation(route);
    if (!tags.has(route.tag)) {
      tags.set(route.tag, route.tag.includes('EBM') || route.tag.includes('RRA')
        ? 'RRA / EBM / VSDC fiscal integration endpoints'
        : `${route.tag} endpoints`);
    }
  }

  // Ensure curated RRA descriptions win for overlapping paths where present.
  for (const [key, methods] of Object.entries(rraOpenApiSpec.paths as Record<string, any>)) {
    paths[key] ||= {};
    for (const [method, operation] of Object.entries(methods)) {
      const existing = paths[key][method] || {};
      paths[key][method] = {
        ...existing,
        ...operation,
        // Keep generated operationId if curated one omitted.
        operationId: (operation as any).operationId || existing.operationId,
        tags: (operation as any).tags || existing.tags,
      };
    }
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'Excledge Backend API',
      version: '1.0.0',
      description: [
        'Full HTTP API for Excledge (inventory, sales, subscriptions, and RRA EBM/VSDC fiscalization).',
        '',
        '## Authentication',
        'Send `Authorization: Bearer <JWT>` from `POST /api/auth/login`.',
        '',
        '## Focused RRA docs',
        'Interactive RRA-only view: `/api/docs/rra`',
        'Full API view: `/api/docs`',
        '',
        '## Related',
        '- `docs/ebm-vsdc/INTEGRATION.md`',
        '- `Postman/EBM-Test-Collection.json` (RRA certification flows)',
        '- `Postman/Excledge-API-Collection.json` (generated full collection)',
      ].join('\n'),
      contact: { name: 'Excledge', url: 'https://erp.exceledgecpa.com' },
    },
    servers: [
      { url: 'http://localhost:4500', description: 'Local development' },
      { url: 'https://erp.exceledgecpa.com', description: 'Production' },
    ],
    tags: [
      ...[...tags.entries()].map(([name, description]) => ({ name, description })),
      ...rraOpenApiSpec.tags.filter((tag: any) => !tags.has(tag.name)),
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        ...(rraOpenApiSpec.components as any).schemas,
      },
      parameters: (rraOpenApiSpec.components as any).parameters,
      responses: (rraOpenApiSpec.components as any).responses,
    },
    paths,
  };
}

function schemaExample(schema: Schema | undefined) {
  if (!schema) return undefined;
  return exampleFor(schema);
}

function toPostmanCollection(openApi: any, name: string, description: string) {
  const folders = new Map<string, any[]>();

  for (const [routePath, methods] of Object.entries(openApi.paths as Record<string, any>)) {
    for (const [method, operation] of Object.entries(methods as Record<string, any>)) {
      const tag = operation.tags?.[0] || 'Other';
      const urlPath = routePath.replace(/\{([^}]+)\}/g, ':$1');
      const segments = urlPath.replace(/^\//, '').split('/');
      const query = (operation.parameters || [])
        .filter((p: any) => p.in === 'query')
        .map((p: any) => ({
          key: p.name,
          value: String(p.schema?.example ?? p.schema?.default ?? ''),
          disabled: !p.required,
          description: p.description || '',
        }));

      const bodySchema = operation.requestBody?.content?.['application/json']?.schema
        || operation.requestBody?.content?.['multipart/form-data']?.schema;
      const exampleBody = operation.requestBody?.content?.['application/json']?.examples
        ? Object.values(operation.requestBody.content['application/json'].examples as Record<string, any>)[0]?.value
        : schemaExample(bodySchema);

      const request: any = {
        name: operation.summary || `${method.toUpperCase()} ${routePath}`,
        request: {
          method: method.toUpperCase(),
          header: [
            { key: 'Authorization', value: 'Bearer {{jwtToken}}' },
            ...(exampleBody !== undefined && !operation.requestBody?.content?.['multipart/form-data']
              ? [{ key: 'Content-Type', value: 'application/json' }]
              : []),
          ],
          url: {
            raw: `{{baseUrl}}${urlPath.replace(/:organizationId|:id\b/g, (m: string) =>
              m.includes('organization') ? '{{organizationId}}' : '{{id}}'
            )}${query.length ? '?' + query.map((q: any) => `${q.key}=${q.value}`).join('&') : ''}`,
            host: ['{{baseUrl}}'],
            path: segments,
            query,
            variable: (operation.parameters || [])
              .filter((p: any) => p.in === 'path')
              .map((p: any) => ({
                key: p.name,
                value: p.name.toLowerCase().includes('organization')
                  ? '{{organizationId}}'
                  : p.name === 'tin'
                    ? '{{ebmTin}}'
                    : p.schema?.example != null
                      ? String(p.schema.example)
                      : '1',
              })),
          },
          description: operation.description || '',
        },
      };

      if (exampleBody !== undefined) {
        if (operation.requestBody?.content?.['multipart/form-data']) {
          request.request.body = {
            mode: 'formdata',
            formdata: Object.keys(bodySchema?.properties || {}).map((key: string) => ({
              key,
              type: bodySchema.properties[key]?.format === 'binary' ? 'file' : 'text',
              src: bodySchema.properties[key]?.format === 'binary' ? [] : undefined,
              value: bodySchema.properties[key]?.format === 'binary'
                ? undefined
                : String((exampleBody as any)?.[key] ?? ''),
            })),
          };
        } else {
          request.request.body = {
            mode: 'raw',
            raw: JSON.stringify(exampleBody, null, 2),
            options: { raw: { language: 'json' } },
          };
        }
      }

      if (operation.security?.length === 0 || method === 'post' && routePath.includes('/auth/login')) {
        request.request.header = request.request.header.filter((h: any) => h.key !== 'Authorization');
      }

      folders.set(tag, [...(folders.get(tag) || []), request]);
    }
  }

  return {
    info: {
      name,
      description,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    auth: {
      type: 'bearer',
      bearer: [{ key: 'token', value: '{{jwtToken}}', type: 'string' }],
    },
    variable: [
      { key: 'baseUrl', value: 'http://localhost:4500' },
      { key: 'jwtToken', value: '' },
      { key: 'organizationId', value: '1' },
      { key: 'id', value: '1' },
      { key: 'ebmTin', value: '999945560' },
    ],
    item: [...folders.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, item]) => ({ name, item })),
  };
}

function writeJson(filePath: string, data: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function main() {
  const routes = getRoutes();
  console.log(`Discovered ${routes.length} routes`);

  const openApi = buildOpenApi(routes);
  const openApiPathOut = path.join(outDir, 'openapi.json');
  const rraPathOut = path.join(outDir, 'openapi-rra.json');
  writeJson(openApiPathOut, openApi);
  writeJson(rraPathOut, rraOpenApiSpec);

  fs.mkdirSync(postmanDir, { recursive: true });
  writeJson(
    path.join(postmanDir, 'Excledge-API-Collection.json'),
    toPostmanCollection(
      openApi,
      'Excledge Full API',
      'Generated from Express routes. Import with Postman/EBM-Environment.json. Prefer /api/docs for interactive exploration.',
    ),
  );
  writeJson(
    path.join(postmanDir, 'Excledge-RRA-API-Collection.json'),
    toPostmanCollection(
      rraOpenApiSpec,
      'Excledge RRA / EBM API',
      'RRA-connected endpoints only — fiscal sales, master data, stock, purchases, imports, CIS reports.',
    ),
  );

  // Keep Backend/postman_collection.json in sync for README compatibility.
  writeJson(
    path.join(backend, 'postman_collection.json'),
    toPostmanCollection(
      openApi,
      'Excledge Full API',
      'Generated full API collection (same as Postman/Excledge-API-Collection.json).',
    ),
  );

  const catalog = routes.map(route => ({
    method: route.method,
    path: route.path,
    tag: route.tag,
    handler: route.handler,
    auth: isAuthenticated(route),
    roles: roles(route),
  }));
  writeJson(path.join(outDir, 'route-catalog.json'), catalog);

  console.log(`Wrote ${openApiPathOut}`);
  console.log(`Wrote ${rraPathOut}`);
  console.log(`Wrote Postman collections in ${postmanDir}`);
  console.log(`Tagged groups: ${[...new Set(routes.map(r => r.tag))].sort().join(', ')}`);
}

main();
