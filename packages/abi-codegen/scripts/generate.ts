import fs from 'fs/promises'
import { resolve } from "path";
import * as ts from 'typescript';
import { GenerateInternalParsers } from './generators/internal';
import { GenerateJettonPayloadParsers } from './generators/jettons';
import { getGlobalIdentifiers } from './generators/globals';

function replaceTemplate(template: string, replace_name: string, replace_value: string) {
  const startName = `/* __${replace_name}__START__ */`
  const endName = `/* __${replace_name}__END__ */`
  const startIndex = template.indexOf(startName)
  const endIndex = template.indexOf(endName)
  return template.slice(0, startIndex) + replace_value + template.slice(endIndex + endName.length)
}

// Group imports by source file path using TypeScript AST
function generateImportsWithAST(items: Array<{exportFunction: string, exportPath: string}>) {
  // Group by path
  const importsByPath: Record<string, Set<string>> = {};
  
  for (const item of items) {
    if (!importsByPath[item.exportPath]) {
      importsByPath[item.exportPath] = new Set();
    }
    importsByPath[item.exportPath].add(item.exportFunction);
  }
  
  // Create an array of import declarations
  const importDeclarations: ts.ImportDeclaration[] = [];
  const exportDeclarations: ts.ExportDeclaration[] = [];
  
  for (const [path, identifiers] of Object.entries(importsByPath)) {
    const importClause = ts.factory.createImportClause(
      false,
      undefined,
      ts.factory.createNamedImports(
        Array.from(identifiers).map(id => 
          ts.factory.createImportSpecifier(
            false,
            undefined,
            ts.factory.createIdentifier(id)
          )
        )
      )
    );
    
    importDeclarations.push(
      ts.factory.createImportDeclaration(
        undefined,
        importClause,
        ts.factory.createStringLiteral(path)
      )
    );

    exportDeclarations.push(
      ts.factory.createExportDeclaration(
        undefined,
        false,
        ts.factory.createNamedExports(
          Array.from(identifiers).map(id => 
            ts.factory.createExportSpecifier(
              false,
              undefined,
              ts.factory.createIdentifier(id)
            )
          )
        ),
        ts.factory.createStringLiteral(path)
      )
    );
  }
  
  // Create source file with import declarations
  const sourceFile = ts.factory.createSourceFile(
    [...importDeclarations, ...exportDeclarations],
    ts.factory.createToken(ts.SyntaxKind.EndOfFileToken),
    ts.NodeFlags.None
  );
  
  // Print the source file
  const printer = ts.createPrinter();
  return printer.printFile(sourceFile);
}


async function main() {
  await fs.mkdir(resolve(__dirname, `../build`), { recursive: true })
  const globalIdentifiers = await getGlobalIdentifiers()

  const schemasDir = resolve(__dirname, '../../../third_party/tongo/abi/schemas')
  const schemas = await fs.readdir(schemasDir)
  const fullSchemaUrls = schemas.map(schema => resolve(schemasDir, schema))

  const internals = await GenerateInternalParsers(fullSchemaUrls, globalIdentifiers)
  const jettonPayloads = await GenerateJettonPayloadParsers(fullSchemaUrls, globalIdentifiers)



  // Generate imports and exports using AST
  const internalImports = generateImportsWithAST(internals);
  const jettonImports = generateImportsWithAST(jettonPayloads);

  let template = await fs.readFile(resolve(__dirname, `./template.ts`), 'utf-8')
  
  template = replaceTemplate(template, 'IMPORTS', `
import { JettonPayload } from './globals';
${internalImports}
${jettonImports}
`)

  template = replaceTemplate(template, 'INTERNAL_PARSERS', `
const internalParsers = [${internals.map(internal => `{
  opCode: 0x${internal.opCode.toString(16)},
  parse: ${internal.exportFunction},
  fixedLength: ${internal.fixedLength},
  folderName: '${internal.folderName}',
  internalName: '${internal.internalName}',
},\n`).join('')}]
`)
  template = replaceTemplate(template, 'JETTON_PAYLOAD_PARSERS', `
const jettonPayloadParsers = [${jettonPayloads.map(payload => `{
  opCode: 0x${payload.opCode.toString(16)},
  parse: ${payload.exportFunction},
  fixedLength: ${payload.fixedLength},
  folderName: '${payload.folderName}',
  payloadName: '${payload.payloadName}',
},\n`).join('')}]
`)
  template = replaceTemplate(template, 'INTERNAL_PARSER_MAP', `
const internalParserMap: { [opCode: string]: number[] } = {
${(() => {
  const map: Record<string, number[]> = {};
  internals.forEach((internal, index) => {
    const opCode = `0x${internal.opCode.toString(16)}`;
    if (!map[opCode]) {
      map[opCode] = [];
    }
    map[opCode].push(index);
  });
  return Object.entries(map).map(([opCode, indices]) => 
    `  ${opCode}: [${indices.join(', ')}]`
  ).join(',\n');
})()}
};
`)
  template = replaceTemplate(template, 'JETTON_PAYLOAD_PARSER_MAP', `
const jettonPayloadParserMap: { [opCode: string]: number[] } = {
${(() => {
  const map: Record<string, number[]> = {};
  jettonPayloads.forEach((payload, index) => {
    const opCode = `0x${payload.opCode.toString(16)}`;
    if (!map[opCode]) {
      map[opCode] = [];
    }
    map[opCode].push(index);
  });
  return Object.entries(map).map(([opCode, indices]) => 
    `  ${opCode}: [${indices.join(', ')}]`
  ).join(',\n');
})()}
};
`)
  template = replaceTemplate(template, 'PARSED_INTERNAL', `
export type ParsedInternal = ${internals.map(internal => `{
  opCode: 0x${internal.opCode.toString(16)}
  schema: '${internal.folderName}'
  internal: '${internal.internalName}'
  boc: Buffer
  data: ReturnType<typeof ${internal.exportFunction}>
}`).join(' | ')}
`)
  template = replaceTemplate(template, 'PARSED_JETTON_PAYLOAD', `
export type ParsedJettonPayload = ${jettonPayloads.map(payload => `{
  opCode: 0x${payload.opCode.toString(16)}
  schema: '${payload.folderName}'
  payload: '${payload.payloadName}'
  boc: Buffer
  data: ReturnType<typeof ${payload.exportFunction}>
}`).join(' | ')}
`)

  await fs.writeFile(resolve(__dirname, `../build/index.ts`), template)
}

main()
