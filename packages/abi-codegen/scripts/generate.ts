import {generateCodeFromData} from '@truecarry/tlb-codegen'
import {XMLParser} from "fast-xml-parser"
import fs from 'fs/promises'
import {resolve} from "path";

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
  'subscriptions_v1'
]

async function main() {
  const schemas = await fs.readdir(resolve(__dirname, '../../../third_party/tongo/abi/schemas'))
  const internals = await Promise.all(schemas.map(async (schema) => {
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

    const XMLdata = await fs.readFile(resolve(__dirname, `../../../third_party/tongo/abi/schemas/${schema}`), {encoding: 'utf-8'})
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

    await Promise.all(internals.map(async (internal) => {
      const tlbToGenerate = `
                ${globalTypes}
                ${types}
                ${internal['#text']}
            `
      const internalName = internal['@_name']

      const generated = await generateCodeFromData(tlbToGenerate, 'typescript')
      await fs.mkdir(resolve(__dirname, `../build/${folderName}/internals`), {recursive: true})
      await fs.writeFile(resolve(__dirname, `../build/${folderName}/internals/${internalName}.ts`), generated)
    }))

    function toCamelCase(str: string) {
      return str.replace(/_([a-zA-Z])/g, function (g) {
        return g[1].toUpperCase();
      });
    }

    const template = `
${internals.map(internal => `export { load${getConstructorType(internal['#text'])} as ${toCamelCase(
      `load_${folderName}_${internal['@_name']}`
    )} } from './internals/${internal['@_name']}';`).join('\n')}
        `;

    await fs.writeFile(resolve(__dirname, `../build/${folderName}/index.ts`), template)

    return internals.map(internal => ({
      schema: schema,
      folderName: folderName,
      // internalName: getConstructorName(internal),
      internalName: internal['@_name'],
      fixedLength: internal['@_fixed_length'] ?? false,
      // internalType: getConstructorType(internal),
      exportPath: `./${folderName}`,
      exportFunction: toCamelCase(`load_${folderName}_${internal['@_name']}`)
    }));
  })).then(p => p.flat().filter(p => p)) as {
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

export function parseInternal(cs: Slice) {
    ${internals.map(internal => `
    try {
        const boc = cs.asCell().toBoc();
        const data = ${internal.exportFunction}(cs);
        
        ${internal.fixedLength ? `if (cs.remainingBits !== 0 || cs.remainingRefs !== 0) {
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
`;

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
