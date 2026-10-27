import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export type Schema = Record<string, any>;
export interface Route {
  method: string;
  path: string;
  tag: string;
  handler: string;
  source: string;
  line: number;
  middleware: string[];
  upload?: string;
  node?: ts.Node;
  file: ts.SourceFile;
}

const backend = path.resolve(__dirname, '../..');
const config = ts.readConfigFile(path.join(backend, 'tsconfig.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, backend);
const program = ts.createProgram(parsed.fileNames, parsed.options);
export const checker = program.getTypeChecker();

export function walk(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node);
  ts.forEachChild(node, child => walk(child, visit));
}

function strings(node?: ts.Node): string[] {
  if (!node) return [];
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(strings);
  return [];
}

function functionNode(expression: ts.Node): ts.Node | undefined {
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return expression;
  let symbol = checker.getSymbolAtLocation(expression);
  if (!symbol && ts.isPropertyAccessExpression(expression)) symbol = checker.getSymbolAtLocation(expression.name);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  for (const declaration of symbol?.declarations || []) {
    if (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) return declaration;
    if ((ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)) && declaration.initializer) {
      const value = declaration.initializer;
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return value;
    }
  }
  return undefined;
}

function moduleFile(importNode: ts.ImportDeclaration, source: ts.SourceFile): ts.SourceFile | undefined {
  const location = strings(importNode.moduleSpecifier)[0];
  if (!location?.startsWith('.')) return undefined;
  const resolved = ts.resolveModuleName(location, source.fileName, parsed.options, ts.sys).resolvedModule;
  return resolved ? program.getSourceFile(resolved.resolvedFileName) : undefined;
}

function collectFrom(source: ts.SourceFile, mount: string, receiver: string): Route[] {
  const routes: Route[] = [];
  const globalMiddleware: string[] = [];
  const aliases = new Map<string, string>();
  walk(source, node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      aliases.set(node.name.text, node.initializer.getText(source));
    }
  });
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) continue;
    const call = statement.expression;
    if (!ts.isPropertyAccessExpression(call.expression) || call.expression.expression.getText(source) !== receiver) continue;
    const method = call.expression.name.text;
    const middleware = call.arguments.slice(strings(call.arguments[0]).length ? 1 : 0).map(arg => {
      const text = arg.getText(source);
      return aliases.get(text) || text;
    });
    if (method === 'use') {
      if (!strings(call.arguments[0]).length) globalMiddleware.push(...middleware);
      else if (middleware.every(text => !text.includes('Routes'))) globalMiddleware.push(...middleware);
      continue;
    }
    if (!['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(method)) continue;
    const handlerExpression = call.arguments[call.arguments.length - 1];
    const handler = functionNode(handlerExpression);
    for (const routePath of strings(call.arguments[0])) {
      const fullPath = (mount + '/' + routePath).replace(/\/+/g, '/').replace(/\/$/, '') || '/';
      const allMiddleware = [...globalMiddleware, ...middleware.slice(0, -1)];
      const upload = allMiddleware.map(text => /\.single\(["']([^"']+)["']\)/.exec(text)?.[1]).find(Boolean);
      const origin = handler?.getSourceFile() || source;
      routes.push({
        method: method.toUpperCase(),
        path: fullPath,
        tag: mount === '/api/organizations' && source.fileName.includes('ebm-outbox') ? 'EBM and RRA' :
          mount === '/api/inventory' && source.fileName.includes('bom-production') ? 'BOM and Production' :
          !mount || mount === '/' ? 'System' :
          mount.replace('/api/', '').replace(/^\//, '').replace(/-/g, ' ').replace(/\b\w/g, char => char.toUpperCase()) || 'System',
        handler: ts.isArrowFunction(handlerExpression) ? method + ' ' + fullPath : handlerExpression.getText(source),
        middleware: allMiddleware,
        upload,
        source: path.relative(backend, origin.fileName).replace(/\\/g, '/'),
        line: origin.getLineAndCharacterOfPosition((handler || statement).getStart(origin)).line + 1,
        node: handler,
        file: origin,
      });
    }
  }
  return routes;
}

export function getRoutes(): Route[] {
  const index = program.getSourceFile(path.join(backend, 'src/index.ts'))!;
  const imported = new Map<string, ts.SourceFile>();
  for (const statement of index.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause?.name) {
      const source = moduleFile(statement, index);
      if (source) imported.set(statement.importClause.name.text, source);
    }
  }
  const result: Route[] = [];
  for (const statement of index.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) continue;
    const call = statement.expression;
    if (!ts.isPropertyAccessExpression(call.expression) || call.expression.getText(index) !== 'app.use') continue;
    const mount = strings(call.arguments[0])[0];
    const source = imported.get(call.arguments[call.arguments.length - 1].getText(index));
    if (!mount || !source?.fileName.includes('/routes/')) continue;
    const receiver = source.statements.flatMap(stmt => {
      if (!ts.isVariableStatement(stmt)) return [];
      return stmt.declarationList.declarations.filter(decl =>
        decl.initializer && ts.isCallExpression(decl.initializer) && /Router$/.test(decl.initializer.expression.getText(source)),
      ).map(decl => decl.name.getText(source));
    })[0] || 'router';
    result.push(...collectFrom(source, mount, receiver));
  }
  result.push(...collectFrom(index, '', 'app'));
  const keys = new Set<string>();
  return result.filter(route => {
    const key = route.method + ' ' + route.path;
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}

const typeCache = new Map<ts.Type, Schema>();
export function typeSchema(type: ts.Type, depth = 0, seen = new Set<ts.Type>()): Schema {
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) return {};
  if (type.flags & ts.TypeFlags.StringLiteral) return { type: 'string', enum: [(type as ts.StringLiteralType).value] };
  if (type.flags & ts.TypeFlags.NumberLiteral) return { type: 'number', enum: [(type as ts.NumberLiteralType).value] };
  if (type.flags & ts.TypeFlags.BooleanLiteral) return { type: 'boolean', enum: [checker.typeToString(type) === 'true'] };
  if (type.flags & ts.TypeFlags.String) return { type: 'string' };
  if (type.flags & ts.TypeFlags.Number) return { type: 'number' };
  if (type.flags & ts.TypeFlags.Boolean) return { type: 'boolean' };
  if (type.flags & ts.TypeFlags.BigInt) return { type: 'string', pattern: '^-?[0-9]+$', description: 'BigInt is serialized as a string.' };
  if (type.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) return { nullable: true };
  if (type.isUnion()) {
    const values = type.types.filter(item => !(item.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)));
    const nullable = values.length !== type.types.length;
    const schemas = values.map(item => typeSchema(item, depth, seen));
    if (schemas.length === 0) return {};
    if (schemas.every(schema => schema.type === schemas[0].type && schema.enum)) {
      return { type: schemas[0].type, enum: schemas.flatMap(schema => schema.enum), ...(nullable ? { nullable: true } : {}) };
    }
    if (schemas.length === 1) return { ...schemas[0], ...(nullable ? { nullable: true } : {}) };
    if (schemas.some(schema => Object.keys(schema).length === 0)) return {};
    return { anyOf: schemas, ...(nullable ? { nullable: true } : {}) };
  }
  const name = type.getSymbol()?.getName() || '';
  if (name === 'Date') return { type: 'string', format: 'date-time' };
  if (name === 'Decimal') return { type: 'string', pattern: '^-?[0-9]+(\\.[0-9]+)?$', description: 'Prisma Decimal is serialized as a decimal string.' };
  if (name === 'Buffer' || name === 'Uint8Array') return { type: 'string', format: 'binary' };
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    const arguments_ = checker.getTypeArguments(type as ts.TypeReference);
    return { type: 'array', items: arguments_[0] ? typeSchema(arguments_[0], depth + 1, seen) : {} };
  }
  if (name === 'Promise') {
    const arguments_ = checker.getTypeArguments(type as ts.TypeReference);
    return arguments_[0] ? typeSchema(arguments_[0], depth, seen) : {};
  }
  if (depth > 4 || seen.has(type)) return { type: 'object', additionalProperties: true };
  if (depth === 0 && typeCache.has(type)) return typeCache.get(type)!;
  const properties: Record<string, Schema> = {};
  const required: string[] = [];
  const nextSeen = new Set(seen).add(type);
  for (const property of checker.getPropertiesOfType(type)) {
    const declaration = property.valueDeclaration || property.declarations?.[0];
    if (!declaration || property.getName().startsWith('__')) continue;
    const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
    if (propertyType.getCallSignatures().length > 0) continue;
    properties[property.getName()] = typeSchema(propertyType, depth + 1, nextSeen);
    if (!(property.flags & ts.SymbolFlags.Optional)) required.push(property.getName());
  }
  const result: Schema = Object.keys(properties).length ? {
    type: 'object', properties, ...(required.length ? { required } : {}),
  } : { type: 'object', additionalProperties: true };
  if (depth === 0) typeCache.set(type, result);
  return result;
}

export function expressionSchema(expression: ts.Expression, visited = new Set<ts.Node>()): Schema {
  if (visited.has(expression)) return {};
  visited = new Set(visited).add(expression);
  if (ts.isAsExpression(expression) || ts.isParenthesizedExpression(expression) ||
      ts.isNonNullExpression(expression) || ts.isAwaitExpression(expression)) return expressionSchema(expression.expression, visited);
  if (ts.isStringLiteralLike(expression)) return { type: 'string', example: expression.text };
  if (ts.isNumericLiteral(expression)) return { type: 'number', example: Number(expression.text) };
  if ([ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(expression.kind)) return { type: 'boolean', example: expression.kind === ts.SyntaxKind.TrueKeyword };
  if (expression.kind === ts.SyntaxKind.NullKeyword) return { nullable: true };
  if (ts.isArrayLiteralExpression(expression)) return { type: 'array', items: expression.elements[0] ? expressionSchema(expression.elements[0], visited) : {} };
  if (ts.isObjectLiteralExpression(expression)) {
    const properties: Record<string, Schema> = {};
    for (const property of expression.properties) {
      if (ts.isSpreadAssignment(property)) {
        const schema = expressionSchema(property.expression, visited);
        Object.assign(properties, schema.properties || {});
      } else if (ts.isPropertyAssignment(property)) {
        properties[property.name.getText().replace(/^["']|["']$/g, '')] = expressionSchema(property.initializer, visited);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        properties[property.name.text] = expressionSchema(property.name, visited);
      }
    }
    return { type: 'object', properties };
  }
  if (ts.isCallExpression(expression)) {
    const name = expression.expression.getText();
    if (/(^|\.)success$/.test(name)) {
      return { type: 'object', required: ['success', 'data'], properties: {
        success: { type: 'boolean', enum: [true] },
        data: expression.arguments[0] ? expressionSchema(expression.arguments[0], visited) : {},
        ...(expression.arguments[1] ? { message: expressionSchema(expression.arguments[1], visited) } : {}),
      } };
    }
    if (/^(apiError|error)$/.test(name)) {
      return { type: 'object', required: ['success', 'error'], properties: {
        success: { type: 'boolean', enum: [false] },
        error: { type: 'string', ...(expression.arguments[0] && ts.isStringLiteralLike(expression.arguments[0]) ? { example: expression.arguments[0].text } : {}) },
        ...(expression.arguments[1] ? { code: expressionSchema(expression.arguments[1], visited) } : {}),
      } };
    }
  }
  let schema = typeSchema(checker.getTypeAtLocation(expression));
  if (Object.keys(schema).length) return schema;
  if (ts.isIdentifier(expression)) {
    let symbol = checker.getSymbolAtLocation(expression);
    if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    for (const declaration of symbol?.declarations || []) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer && !visited.has(declaration)) {
        schema = expressionSchema(declaration.initializer, new Set(visited).add(declaration));
        if (Object.keys(schema).length) return schema;
      }
    }
  }
  return {};
}

export function inspect(route: Route) {
  const body = new Map<string, Schema>();
  const query = new Map<string, Schema>();
  const required = new Set<string>();
  const responses: Record<string, { schema: Schema; json: boolean; mime?: string }> = {};
  if (!route.node) return { body, query, required, responses };
  const parameters = (route.node as ts.FunctionLikeDeclaration).parameters;
  const req = parameters?.[0]?.name.getText() || 'req';
  const res = parameters?.[1]?.name.getText() || 'res';
  const aliases = new Map<string, 'body' | 'query'>();
  function root(expression: ts.Expression): 'body' | 'query' | undefined {
    if (ts.isBinaryExpression(expression) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(expression.operatorToken.kind)) return root(expression.left);
    const text = expression.getText().replace(/\s/g, '');
    if (text === req + '.body') return 'body';
    if (text === req + '.query') return 'query';
    return aliases.get(text);
  }
  walk(route.node, node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const location = root(node.initializer);
      if (location) aliases.set(node.name.text, location);
    }
  });
  walk(route.node, node => {
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer) {
      const location = root(node.initializer);
      if (location) for (const element of node.name.elements) {
        if (element.dotDotDotToken) continue;
        const name = (element.propertyName || element.name).getText().replace(/^["']|["']$/g, '');
        const schema = typeSchema(checker.getTypeAtLocation(element.name));
        if (element.initializer && (ts.isNumericLiteral(element.initializer) || ts.isStringLiteralLike(element.initializer))) {
          schema.default = ts.isNumericLiteral(element.initializer) ? Number(element.initializer.text) : element.initializer.text;
        }
        (location === 'body' ? body : query).set(name, schema);
      }
    }
    if (ts.isPropertyAccessExpression(node)) {
      const location = root(node.expression);
      if (location && !['toString', 'filter', 'map', 'length', 'reduce', 'forEach'].includes(node.name.text)) {
        const target = location === 'body' ? body : query;
        target.set(node.name.text, { ...target.get(node.name.text), ...typeSchema(checker.getTypeAtLocation(node)) });
      }
    }
    if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)) {
      const location = root(node.expression);
      if (location) (location === 'body' ? body : query).set(node.argumentExpression.text, typeSchema(checker.getTypeAtLocation(node)));
    }
    if (ts.isIfStatement(node) && node.thenStatement.getText().includes('.status(400)')) {
      if (/^!?\s*[A-Za-z0-9_]+\s*(\|\|\s*![A-Za-z0-9_]+\s*)*$/.test(node.expression.getText())) {
        for (const match of node.expression.getText().matchAll(/!\s*(\w+)/g)) if (body.has(match[1])) required.add(match[1]);
      }
    }
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    if (!['json', 'send', 'end', 'redirect', 'download', 'sendFile'].includes(node.expression.name.text)) return;
    if (!node.expression.expression.getText().startsWith(res)) return;
    const responseText = node.expression.expression.getText();
    const status = /\.(?:status)\((\d+)\)/.exec(responseText)?.[1] ||
      (node.expression.name.text === 'redirect' ? '302' : '200');
    const json = node.expression.name.text === 'json';
    const schema = json && node.arguments[0] ? expressionSchema(node.arguments[0]) : { type: 'string', format: 'binary' };
    if (!responses[status] || Object.keys(schema.properties || {}).length > Object.keys(responses[status].schema.properties || {}).length) {
      responses[status] = { schema, json };
    }
  });
  return { body, query, required, responses };
}

if (process.argv.includes('--inspect')) {
  const routes = getRoutes();
  const catalog = routes.map(route => {
    const result = inspect(route);
    return { method: route.method, path: route.path, handler: route.handler, source: route.source, line: route.line,
      authenticated: route.middleware.some(text => /authenticate|requireSystemOwner/.test(text)),
      upload: route.upload, body: [...result.body.keys()], query: [...result.query.keys()], responses: Object.keys(result.responses),
    };
  });
  fs.writeFileSync(path.join(backend, 'temp/api-route-catalog.json'), JSON.stringify(catalog, null, 2));
  console.log('Mapped ' + catalog.length + ' endpoints. Catalog: temp/api-route-catalog.json');
}
