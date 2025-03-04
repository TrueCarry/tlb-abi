import { generateCodeFromData } from '@truecarry/tlb-codegen'
import { XMLParser } from "fast-xml-parser"
import fs from 'fs/promises'
import { resolve } from "path";
import * as ts from 'typescript';

const globalTypes = `
    fixed_length_text$_ n:(uint 8) value:(n * uint8)
         = FixedLengthText;

    unit$_ = Unit;
    true$_ = True;
    nothing$0 {X:Type} = Maybe X;
    just$1 {X:Type} value:X = Maybe X;
    left$0 {X:Type} {Y:Type} value:X = Either X Y;
    right$1 {X:Type} {Y:Type} value:Y = Either X Y;
    pair$_ {X:Type} {Y:Type} first:X second:Y = Both X Y;
    _ grams:Grams = Coins;
    jetton_payload#_ data:Cell = JettonPayload;
    nft_payload#_ data:Cell = NFTPayload;
    bytes#_ data:Cell = Bytes;

    text#_ = Text;

    hm_edge#_ {n:#} {X:Type} {l:#} {m:#} label:(HmLabel ~l n) 
    {n = (~m) + l} node:(HashmapNode m X) = Hashmap n X;

hmn_leaf#_ {X:Type} value:X = HashmapNode 0 X;
hmn_fork#_ {n:#} {X:Type} left:^(Hashmap n X) 
     right:^(Hashmap n X) = HashmapNode (n + 1) X;

hml_short$0 {m:#} {n:#} len:(Unary ~n) {n <= m} s:(n * Bit) = HmLabel ~n m;
hml_long$10 {m:#} n:(#<= m) s:(n * Bit) = HmLabel ~n m;
hml_same$11 {m:#} v:Bit n:(#<= m) = HmLabel ~n m;

unary_zero$0 = Unary ~0;
unary_succ$1 {n:#} x:(Unary ~n) = Unary ~(n + 1);

    
bit$_ (## 1) = Bit;

 proto_http#4854 = Protocol;
proto_list_nil$0 = ProtoList;

proto_list_next$1 head:Protocol tail:ProtoList = ProtoList;



cap_is_wallet#2177 = SmcCapability;

cap_list_nil$0 = SmcCapList;
cap_list_next$1 head:SmcCapability tail:SmcCapList = SmcCapList;

dns_smc_address#9fd3 smc_addr:MsgAddressInt flags:(## 8) { flags <= 1 }
  cap_list:flags . 0?SmcCapList = DNSRecord;
dns_next_resolver#ba93 resolver:MsgAddressInt = DNSRecord;
dns_adnl_address#ad01 adnl_addr:bits256 flags:(## 8) { flags <= 1 }
  proto_list:flags . 0?ProtoList = DNSRecord;
dns_storage_address#7473 bag_id:bits256 = DNSRecord;
`

const ignoreList = [
  'tegro',
  'subscriptions_v1',
  'wallets',
  'multisig',
]

function toCamelCase(str: string) {
  return str.replace(/_([a-zA-Z])/g, function (g) {
    return g[1].toUpperCase();
  });
}

function toPascalCase(string: string) {
  return `${string}`
    .toLowerCase()
    .replace(new RegExp(/[-_]+/, 'g'), ' ')
    .replace(new RegExp(/[^\w\s]/, 'g'), '')
    .replace(
      new RegExp(/\s+(.)(\w*)/, 'g'),
      ($1, $2, $3) => `${$2.toUpperCase() + $3}`
    )
    .replace(new RegExp(/\w/), s => s.toUpperCase());
}
async function main() {
  const globalTypesTlb = await generateCodeFromData(globalTypes, 'typescript')
  await fs.mkdir(resolve(__dirname, `../build`), { recursive: true })
  await fs.writeFile(resolve(__dirname, `../build/globals.ts`), globalTypesTlb)
  const globalsAst = ts.createSourceFile('temp.ts', globalTypesTlb, ts.ScriptTarget.Latest)
  let globalIdentifiers: string[] = []

  function globalTransformer<T extends ts.Node>(context: ts.TransformationContext) {
    return (rootNode: T) => {
      const visitor = (node: ts.Node): ts.Node => {
        if (node.kind === ts.SyntaxKind.FunctionDeclaration) {
          const functionName = (node as ts.FunctionDeclaration)?.name?.escapedText

          globalIdentifiers.push(functionName as string)
        }
        if (node.kind === ts.SyntaxKind.InterfaceDeclaration) {
          const functionName = (node as ts.InterfaceDeclaration)?.name?.escapedText

          globalIdentifiers.push(functionName as string)
        }
        if (node.kind === ts.SyntaxKind.TypeAliasDeclaration) {
          const functionName = (node as ts.TypeAliasDeclaration)?.name?.escapedText

          globalIdentifiers.push(functionName as string)
        }
        return ts.visitEachChild(node, visitor, context);
      };

      return ts.visitNode(rootNode, visitor);
    }
  }
  ts.transform(globalsAst, [globalTransformer])

  const schemas = await fs.readdir(resolve(__dirname, '../../../third_party/tongo/abi/schemas'))
  const internals = await Promise.all(schemas.map(async (schema, i) => {
    // for (const schema of schemas) {
    const isFile = await fs.stat(resolve(__dirname, `../../../third_party/tongo/abi/schemas/${schema}`)).then(stat => stat.isFile()).catch(() => false)
    const isXml = schema.endsWith('.xml')
    if (!isFile || !isXml) {
      return //continue
    }
    const folderName = schema
      .replace('.xml', '')
      .replace(/-/g, '_')

    if (ignoreList.includes(folderName)) {
      return
    }

    const XMLdata = await fs.readFile(resolve(__dirname, `../../../third_party/tongo/abi/schemas/${schema}`), { encoding: 'utf-8' })
    const parser = new XMLParser({
      ignoreAttributes: false,
      allowBooleanAttributes: true,

    });
    let jObj = parser.parse(XMLdata);
    let internals = jObj['abi']['internal'] as undefined | { '#text': string, '@_name': string, '@_fixed_length'?: boolean } | {
      '#text': string,
      '@_name': string,
      '@_fixed_length'?: boolean
    }[]
    if (typeof internals === 'undefined') {
      return //continue
    }
    if (!Array.isArray(internals)) {
      internals = [internals]
    }
    const types = jObj['abi']['types'] as string ?? ''
    if (!Array.isArray(internals)) {
      return //continue
    }

    const generatedInternals = await Promise.all(internals.map(async (internal) => {
      const tlbToGenerate = `
                ${globalTypes}
                ${types}
                ${internal['#text']}
            `
      const internalName = internal['@_name']
      const pascalCaseName = toPascalCase(internalName)

      const nameRegex = new RegExp(`=([ \n])+(.+);$`)
      const opcodeRegex = new RegExp(`^([a-zA-Z0-9_]+)#([a-f0-9]+)`)

      const codeName = nameRegex.exec(internal['#text'])
      const opCode = opcodeRegex.exec(internal['#text'])
      if (!codeName) {
        console.log('Not found', internal)
        throw new Error('Name not found')
      }
      if (!opCode) {
        console.log('Not found', internal)
        throw new Error('OpCode not found')
      }

      let generated = await generateCodeFromData(tlbToGenerate, 'typescript')
      if (generated) {
        generated = generated.replace(new RegExp(codeName[2], 'g'), pascalCaseName)

        function transformer<T extends ts.Node>(context: ts.TransformationContext) {
          return (rootNode: T) => {
            const visitor = (node: ts.Node): ts.Node => {
              if (node.kind === ts.SyntaxKind.FunctionDeclaration) {
                const text = (node as ts.FunctionDeclaration).name?.escapedText
                if (globalIdentifiers.includes(text as string)) {
                  return undefined as any
                }
              }
              if (node.kind === ts.SyntaxKind.InterfaceDeclaration) {
                const text = (node as ts.FunctionDeclaration).name?.escapedText
                if (globalIdentifiers.includes(text as string)) {
                  return undefined as any
                }
              }
              if (node.kind === ts.SyntaxKind.TypeAliasDeclaration) {
                const text = (node as ts.FunctionDeclaration).name?.escapedText
                if (globalIdentifiers.includes(text as string)) {
                  return undefined as any
                }
              }
              return ts.visitEachChild(node, visitor, context);
            };

            return ts.visitNode(rootNode, visitor);
          }
        }
        const ast = ts.createSourceFile('temp.ts', generated, ts.ScriptTarget.Latest)
        const newAst = ts.transform(ast, [transformer])

        generated = ts.createPrinter().printNode(0, newAst.transformed[0], ast)
        generated = `
import {
  Maybe, bitLen, Both, Either,
  loadMaybe, storeMaybe, loadBoth, storeBoth, loadEither, storeEither,
  Bytes, loadBytes, storeBytes,
  Coins, loadCoins, storeCoins,
  DNSRecord, loadDNSRecord, storeDNSRecord,
  DNSRecord_dns_adnl_address, DNSRecord_dns_next_resolver,
  DNSRecord_dns_smc_address,
  DNSRecord_dns_storage_address,
  Either_left,
  Either_right,
  FixedLengthText, loadFixedLengthText, storeFixedLengthText, Hashmap, HashmapNode,
  HashmapNode_hmn_fork, HashmapNode_hmn_leaf, HmLabel, HmLabel_hml_long, HmLabel_hml_same,
  HmLabel_hml_short, loadHashmapNode, storeHashmapNode, loadHmLabel, storeHmLabel,
  loadHashmap, storeHashmap, JettonPayload, loadJettonPayload, storeJettonPayload,
  Maybe_just, Maybe_nothing, NFTPayload, loadNFTPayload, storeNFTPayload,
  ProtoList, loadProtoList, storeProtoList, ProtoList_proto_list_next,
  ProtoList_proto_list_nil, Protocol, SmcCapList, loadSmcCapList, storeSmcCapList,
  SmcCapList_cap_list_next, SmcCapList_cap_list_nil,
  SmcCapability, Text, loadText, storeText, loadProtocol, storeProtocol,
  loadSmcCapability, storeSmcCapability, True, loadTrue, storeTrue,
  Unary, loadUnary, storeUnary, Unary_unary_succ, Unary_unary_zero, Unit,
  hashmap_get_l, hmLabel_hml_short_get_n, loadUnit, storeUnit, unary_unary_succ_get_n,
  loadBool, Bool, storeBool
} from '../../globals';
${generated}
`
      }
      await fs.mkdir(resolve(__dirname, `../build/${folderName}/internals`), { recursive: true })
      await fs.writeFile(resolve(__dirname, `../build/${folderName}/internals/${internalName}.ts`), generated)

      return {
        folderName,
        internalName,
        pascalCaseName,
        opCode: parseInt(opCode[2], 16),
        fixedLength: internal['@_fixed_length'] ?? false,
      }
    }))



    const template = `
${generatedInternals.map(internal => `export { load${internal.pascalCaseName} as ${toCamelCase(
      `load_${folderName}_${internal.internalName}`
    )} } from './internals/${internal.internalName}';`).join('\n')}
        `;

    await fs.writeFile(resolve(__dirname, `../build/${folderName}/index.ts`), template)

    return generatedInternals.map(internal => ({
      ...internal,
      schema: schema,
      folderName: folderName,
      // internalName: getConstructorName(internal),
      // internalName: internal.internalName,
      // fixedLength: internal.fixedLength,
      // internalType: getConstructorType(internal),
      exportPath: `./${folderName}`,
      exportFunction: toCamelCase(`load_${folderName}_${internal.internalName}`)
    }));
  })).then(p => p.flat().filter(p => p)) as {
    pascalCaseName: string,
    opCode: number,
    schema: string,
    folderName: string,
    internalName: string,
    fixedLength: boolean,
    // internalType: string,
    exportPath: string,
    exportFunction: string
  }[];

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

  /*
  
  export function parseInternal(cs: Slice) {
      ${internals.map(internal => `
      try {
          const boc = cs.asCell().toBoc();
          const data = ${internal.exportFunction}(cs);${
          internal.fixedLength ? `
          if (cs.remainingBits !== 0 || cs.remainingRefs !== 0) {
              throw new Error('Invalid data length');
          }` : ''}
          return {
              schema: '${internal.folderName}' as const,
              internal: '${internal.internalName}' as const,
              boc: boc,
              data: data,
          };
      } catch (e) {}
  `).join('\n')}
  
      throw new Error('Unknown internal');
  } 
  */
  await fs.writeFile(resolve(__dirname, `../build/index.ts`), template)
}

main()


// function getConstructorName(internal: string): string {
//   const nameRegex = /([a-zA-Z0-9_-]+)#([a-f0-9]{8})/
//   const internalNameMatch = internal.match(nameRegex)
//   if (!internalNameMatch || internalNameMatch.length < 2) {
//     console.log('Not found', internal)
//     throw new Error('Name not found')
//   }
//
//   const internalName = internalNameMatch[1]
//   if (!internalName) {
//     console.log('Not found', internal, internalNameMatch)
//     throw new Error('Name not found')
//   }
//
//   return internalName
// }

function getConstructorType(internal: string): string {
  const nameRegex = /=\s+([a-zA-Z0-9_-]+);/
  const internalNameMatch = internal.replace(/\n/g, ' ').match(nameRegex)
  if (!internalNameMatch || internalNameMatch.length < 2) {
    console.log('Not found', internal)
    throw new Error('Name not found')
  }

  const internalType = internalNameMatch[1]
  if (!internalType) {
    console.log('Not found', internal, internalNameMatch)
    throw new Error('Type not found')
  }

  return internalType
}
