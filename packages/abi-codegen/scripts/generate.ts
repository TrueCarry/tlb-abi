import fs from 'fs/promises'
import { resolve } from "path";
import * as ts from 'typescript';
import { GenerateInternalParsers } from './generators/internal';
import { GenerateJettonPayloadParsers } from './generators/jettons';
import { getGlobalIdentifiers } from './generators/globals';

async function main() {
  await fs.mkdir(resolve(__dirname, `../build`), { recursive: true })
  const globalIdentifiers = await getGlobalIdentifiers()

  const schemasDir = resolve(__dirname, '../../../third_party/tongo/abi/schemas')
  const schemas = await fs.readdir(schemasDir)
  const fullSchemaUrls = schemas.map(schema => resolve(schemasDir, schema))

  const internals = await GenerateInternalParsers(fullSchemaUrls, globalIdentifiers)
  const jettonPayloads = await GenerateJettonPayloadParsers(fullSchemaUrls, globalIdentifiers)

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
    }
    
    // Create source file with import declarations
    const sourceFile = ts.factory.createSourceFile(
      importDeclarations,
      ts.factory.createToken(ts.SyntaxKind.EndOfFileToken),
      ts.NodeFlags.None
    );
    
    // Print the source file
    const printer = ts.createPrinter();
    return printer.printFile(sourceFile);
  }
  
  // Generate re-exports with AST to avoid duplicates
  function generateExportsWithAST(items: Array<{exportFunction: string, exportPath: string}>) {
    // Group by path and track function names to avoid duplicates
    const exportsByPath: Record<string, Set<string>> = {};
    const seenExports = new Set<string>();
    
    for (const item of items) {
      // Skip if we've already seen this function export (avoid duplicates)
      if (seenExports.has(item.exportFunction)) {
        continue;
      }
      
      if (!exportsByPath[item.exportPath]) {
        exportsByPath[item.exportPath] = new Set();
      }
      
      exportsByPath[item.exportPath].add(item.exportFunction);
      seenExports.add(item.exportFunction);
    }
    
    // Create export declarations
    const exportDeclarations: ts.ExportDeclaration[] = [];
    
    for (const [path, identifiers] of Object.entries(exportsByPath)) {
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
    
    // Create source file with export declarations
    const sourceFile = ts.factory.createSourceFile(
      exportDeclarations,
      ts.factory.createToken(ts.SyntaxKind.EndOfFileToken),
      ts.NodeFlags.None
    );
    
    // Print the source file
    const printer = ts.createPrinter();
    return printer.printFile(sourceFile);
  }

  // Generate imports and exports using AST
  const internalImports = generateImportsWithAST(internals);
  const internalExports = generateExportsWithAST(internals);
  
  const jettonImports = generateImportsWithAST(jettonPayloads);
  const jettonExports = generateExportsWithAST(jettonPayloads);

  const template = `
import { Slice } from '@ton/core';
import debug from 'debug';
import { JettonPayload } from './globals';

${internalImports}
${internalExports}
${jettonImports}
${jettonExports}

export type JettonPayloadWithParsed = JettonPayload & { parsed?: ParsedJettonPayload }

// Recursive type mapper that replaces JettonPayload with JettonPayloadWithParsed
export type ReplaceJettonPayload<T> = 
  T extends JettonPayload ? JettonPayloadWithParsed :
  T extends Array<infer U> ? 
    U extends JettonPayload ? Array<JettonPayloadWithParsed> : 
    Array<ReplaceJettonPayload<U>> :
  T extends { [K in keyof T]: T[K] extends JettonPayload ? true : never }[keyof T] ? 
    { [K in keyof T]: ReplaceJettonPayload<T[K]> } :
  T;

const internalParsers = [${internals.map(internal => `{
  opCode: 0x${internal.opCode.toString(16)},
  parse: ${internal.exportFunction},
  fixedLength: ${internal.fixedLength},
  folderName: '${internal.folderName}',
  internalName: '${internal.internalName}',
},\n`).join('')}]

const jettonPayloadParsers = [${jettonPayloads.map(payload => `{
  opCode: 0x${payload.opCode.toString(16)},
  parse: ${payload.exportFunction},
  fixedLength: ${payload.fixedLength},
  folderName: '${payload.folderName}',
  payloadName: '${payload.payloadName}',
},\n`).join('')}]

const debugInternal = debug('tlb-abi:internal')
const debugJetton = debug('tlb-abi:jetton')

// Precalculated lookup maps - maps opCodes to array indices
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

export type ParsedInternal = ${internals.map(internal => `{
  opCode: 0x${internal.opCode.toString(16)}
  schema: '${internal.folderName}'
  internal: '${internal.internalName}'
  boc: Buffer
  data: ReturnType<typeof ${internal.exportFunction}>
}`).join(' | ')}

export type ParsedJettonPayload = ${jettonPayloads.map(payload => `{
  opCode: 0x${payload.opCode.toString(16)}
  schema: '${payload.folderName}'
  payload: '${payload.payloadName}'
  boc: Buffer
  data: ReturnType<typeof ${payload.exportFunction}>
}`).join(' | ')}

export type ParsedInternalWithPayload = ReplaceJettonPayload<ParsedInternal>

export function parseInternal(cs: Slice): ParsedInternal | undefined {
    if (cs.remainingBits < 32) {
      return undefined;
    }

    const opCode = cs.preloadUint(32);
    const parserIndices = internalParserMap[opCode];
    
    if (parserIndices) {
      for (const index of parserIndices) {
        const parser = internalParsers[index];
        try {
          const boc = cs.asCell().toBoc();
          const data = parser.parse(cs);
          if (parser.fixedLength && (cs.remainingBits !== 0 || cs.remainingRefs !== 0)) {
            throw new Error('Invalid data length');
          }
          return {
            opCode: parser.opCode as any,
            schema: parser.folderName as any,
            internal: parser.internalName as any,
            boc: boc,
            data: data,
          } as any;
        } catch (e) {
          debugInternal('Failed to parse internal: %s', e)
        }
      }
    }

    return undefined;
}

export function parseJettonPayload(cs: Slice): ParsedJettonPayload | undefined {
    if (cs.remainingBits < 32) {
      return undefined;
    }

    const opCode = cs.preloadUint(32);
    const parserIndices = jettonPayloadParserMap[opCode];
    
    if (parserIndices) {
      for (const index of parserIndices) {
        const parser = jettonPayloadParsers[index];
        try {
          const boc = cs.asCell().toBoc();
          const data = parser.parse(cs);
          if (parser.fixedLength && (cs.remainingBits !== 0 || cs.remainingRefs !== 0)) {
            throw new Error('Invalid data length');
          }
          return {
            opCode: parser.opCode as any,
            schema: parser.folderName as any,
            payload: parser.payloadName as any,
            boc: boc,
            data: data,
          } as any;
        } catch (e) {
          debugJetton('Failed to parse jetton payload: %s', e)}
        }
    }

    return undefined;
}

export function parseWithPayloads<T extends ParsedInternal>(cs: Slice): ReplaceJettonPayload<T> | undefined {
  const internal = parseInternal(cs) as T
  if (!internal) {
    return undefined
  }

  // Recursive function to deep search the object
  const processPayloads = (obj: any): any => {
    if (!obj || typeof obj !== 'object') {
      return obj
    }
    if (obj?.prototype && typeof obj?.prototype === 'object') {
      return obj
    }
    if (obj?.constructor && typeof obj?.constructor === 'function') {
      return obj
    }

    // Handle arrays
    if (Array.isArray(obj)) {
      return obj.map(item => processPayloads(item))
    }

    // Process each property
    const result = obj
    for (const key in result) {
      const value = result[key]

      if (value instanceof Buffer) {
        continue
      }
      if (value?.prototype && typeof value?.prototype === 'object') {
        continue
      }
      // If we have a Buffer that could be a JettonPayload, try to parse it
      if (value instanceof Object && 'kind' in value && value.kind === 'JettonPayload') {
        try {
          const slice = value.data.asSlice()
          const payload = parseJettonPayload(slice)
          if (payload) {
            result[key]['parsed'] = payload
          }
        } catch (e) {
          // Not a valid Jetton payload, leave as is
        }
      } else if (typeof value === 'object' && value !== null) {
        // Recursively process nested objects
        result[key] = processPayloads(value)
      }
    }
    
    return result
  }

  return processPayloads(internal)
}
`;

  await fs.writeFile(resolve(__dirname, `../build/index.ts`), template)
}

main()
