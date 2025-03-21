import fs from 'fs/promises'
import { resolve } from "path";
import { GenerateInternalParsers } from './generators/internal';
import { getGlobalIdentifiers } from './generators/globals';

async function main() {
  await fs.mkdir(resolve(__dirname, `../build`), { recursive: true })
  const globalIdentifiers = await getGlobalIdentifiers()

  const schemasDir = resolve(__dirname, '../../../third_party/tongo/abi/schemas')
  const schemas = await fs.readdir(schemasDir)
  const fullSchemaUrls = schemas.map(schema => resolve(schemasDir, schema))
  const internals = await GenerateInternalParsers(fullSchemaUrls, globalIdentifiers)

  const template = `
import { Slice } from '@ton/core';

${internals.map(internal => `import { ${internal.exportFunction} } from '${internal.exportPath}';`).join('\n')}
${internals.map(internal => `export { ${internal.exportFunction} } from '${internal.exportPath}';`).join('\n')}

const parsers = [${internals.map(internal => `{
  opCode: 0x${internal.opCode.toString(16)},
  parse: ${internal.exportFunction},
  fixedLength: ${internal.fixedLength},
  folderName: '${internal.folderName}',
  internalName: '${internal.internalName}',
},\n`).join('')}]

export type ParsedInternal = ${internals.map(internal => `{
  opCode: 0x${internal.opCode.toString(16)}
  schema: '${internal.folderName}'
  internal: '${internal.internalName}'
  boc: Buffer
  data: ReturnType<typeof ${internal.exportFunction}>
}`).join(' | ')}

export function parseInternal(cs: Slice): ParsedInternal | undefined {
    if (cs.remainingBits < 32) {
      return undefined;
    }

    const opCode = cs.preloadUint(32);
    for (const parser of parsers) {
        if (opCode === parser.opCode) {
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
          } catch (e) {}
        }
    }

    return undefined;
}
`;

  await fs.writeFile(resolve(__dirname, `../build/index.ts`), template)
}

main()
