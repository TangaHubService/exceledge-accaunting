"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mountApiDocs = mountApiDocs;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
const rra_openapi_1 = require("./rra-openapi");
function loadSpec(fileName) {
    const candidates = [
        node_path_1.default.join(__dirname, fileName),
        node_path_1.default.join(process.cwd(), 'src/docs', fileName),
        node_path_1.default.join(process.cwd(), 'dist/docs', fileName),
    ];
    for (const candidate of candidates) {
        if (node_fs_1.default.existsSync(candidate)) {
            return JSON.parse(node_fs_1.default.readFileSync(candidate, 'utf8'));
        }
    }
    if (fileName.includes('rra')) {
        return rra_openapi_1.rraOpenApiSpec;
    }
    return {
        openapi: '3.0.3',
        info: {
            title: 'Excledge Backend API',
            version: '1.0.0',
            description: 'Run `npm run docs:generate` in Backend to rebuild OpenAPI from routes.',
        },
        paths: {},
    };
}
function docsLanding(_req, res) {
    res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Excledge API Documentation</title>
  <style>
    :root { color-scheme: light; font-family: "Segoe UI", system-ui, sans-serif; }
    body { margin: 0; background: #f6f7f9; color: #15202b; }
    main { max-width: 720px; margin: 0 auto; padding: 48px 24px; }
    h1 { font-size: 1.75rem; margin: 0 0 8px; }
    p { line-height: 1.5; color: #44505c; }
    .grid { display: grid; gap: 12px; margin-top: 24px; }
    a.card {
      display: block; padding: 16px 18px; border: 1px solid #d7dde5; border-radius: 10px;
      background: #fff; text-decoration: none; color: inherit;
    }
    a.card:hover { border-color: #1f6feb; }
    a.card strong { display: block; margin-bottom: 4px; }
    code { background: #eef2f6; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <main>
    <h1>Excledge API Documentation</h1>
    <p>Interactive OpenAPI docs for the backend. Use the RRA view when selling or integrating fiscal endpoints.</p>
    <div class="grid">
      <a class="card" href="/api/docs/full"><strong>Full Backend API</strong>All authenticated routes discovered from Express.</a>
      <a class="card" href="/api/docs/rra"><strong>RRA / EBM API</strong>Fiscal sales, master data, stock, purchases, imports, CIS reports.</a>
      <a class="card" href="/api/docs/openapi.json"><strong>openapi.json</strong>Full OpenAPI 3.0 document.</a>
      <a class="card" href="/api/docs/rra.json"><strong>rra.json</strong>RRA-only OpenAPI 3.0 document.</a>
    </div>
    <p style="margin-top:24px">Regenerate with <code>npm run docs:generate</code> in <code>Backend/</code>. Postman collections live in <code>Postman/</code>.</p>
  </main>
</body>
</html>`);
}
/**
 * Mount interactive API documentation.
 *
 * - GET /api/docs              → docs landing page
 * - GET /api/docs/full         → full backend OpenAPI (Swagger UI)
 * - GET /api/docs/rra          → RRA / EBM focused OpenAPI (Swagger UI)
 * - GET /api/docs/openapi.json → full spec JSON
 * - GET /api/docs/rra.json     → RRA-only spec JSON
 */
function mountApiDocs(app) {
    const fullSpec = loadSpec('openapi.json');
    const rraSpec = loadSpec('openapi-rra.json');
    app.get('/api/docs/openapi.json', (_req, res) => {
        res.json(fullSpec);
    });
    app.get('/api/docs/rra.json', (_req, res) => {
        res.json(rraSpec);
    });
    app.get('/api/docs', docsLanding);
    const uiOptions = {
        customCss: '.swagger-ui .topbar { display: none }',
    };
    // serveFiles avoids the shared-state bug when mounting two Swagger UIs.
    app.use('/api/docs/full', swagger_ui_express_1.default.serveFiles(fullSpec), swagger_ui_express_1.default.setup(fullSpec, {
        ...uiOptions,
        customSiteTitle: 'Excledge Full API',
        swaggerOptions: { persistAuthorization: true, docExpansion: 'none' },
    }));
    app.use('/api/docs/rra', swagger_ui_express_1.default.serveFiles(rraSpec), swagger_ui_express_1.default.setup(rraSpec, {
        ...uiOptions,
        customSiteTitle: 'Excledge RRA / EBM API',
        swaggerOptions: { persistAuthorization: true, docExpansion: 'list' },
    }));
}
