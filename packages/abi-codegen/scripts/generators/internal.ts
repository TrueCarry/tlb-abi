import { generateCodeFromData } from '@ton-community/tlb-codegen'
import { XMLParser } from "fast-xml-parser"
import fs from 'fs/promises'
import { resolve } from "path";
import * as ts from 'typescript';
import { toCamelCase, toPascalCase } from '../lib';
import { globalTypes } from './globals';
import { ignoreList } from '../constants';
import path from 'path';

export async function GenerateInternalParsers(schemas: string[], globalIdentifiers: string[]) {
  const internals = await Promise.all(schemas.map(async (schema, i) => {
    // for (const schema of schemas) {
    const isFile = await fs.stat(schema).then(stat => stat.isFile()).catch(() => false)
    const isXml = schema.endsWith('.xml')
    if (!isFile || !isXml) {
      return //continue
    }

    const fileName = path.basename(schema)

    const folderName = fileName
      .replace('.xml', '')
      .replace(/-/g, '_')

    if (ignoreList.includes(folderName)) {
      return
    }

    const XMLdata = await fs.readFile(schema, { encoding: 'utf-8' })
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
      await fs.mkdir(resolve(__dirname, `../../build/${folderName}/internals`), { recursive: true })
      await fs.writeFile(resolve(__dirname, `../../build/${folderName}/internals/${internalName}.ts`), generated)

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

    await fs.writeFile(resolve(__dirname, `../../build/${folderName}/index.ts`), template)

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

  return internals
}
