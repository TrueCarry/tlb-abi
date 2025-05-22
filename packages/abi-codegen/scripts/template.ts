import { Slice } from '@ton/core';
import debug from 'debug';

/* __IMPORTS__START__ */
import { JettonPayload } from '../build/globals';

import { loadDaolamaDaolamaVaultSupply, loadDaolamaDaolamaVaultWithdraw } from "../build/daolama";
export { loadDaolamaDaolamaVaultSupply, loadDaolamaDaolamaVaultWithdraw } from "../build/daolama";
import { loadDedustJettonDedustSwap, loadDedustJettonDedustDepositLiquidity } from "../build/dedust/jetton_index";
export { loadDedustJettonDedustSwap, loadDedustJettonDedustDepositLiquidity } from "../build/dedust/jetton_index";
/* __IMPORTS__END__ */

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

/* __INTERNAL_PARSERS__START__ */
const internalParsers = [{
    opCode: 0x5c11ada9,
    parse: loadDaolamaDaolamaVaultSupply,
    fixedLength: false,
    folderName: 'daolama',
    internalName: 'daolama_vault_supply',
}]
/* __INTERNAL_PARSERS__END__ */

/* __JETTON_PAYLOAD_PARSERS__START__ */
const jettonPayloadParsers = [{
    opCode: 0xe3a0d482,
    parse: loadDedustJettonDedustSwap,
    fixedLength: false,
    folderName: 'dedust',
    payloadName: 'dedust_swap',
}]
/* __JETTON_PAYLOAD_PARSERS__END__ */
const debugInternal = debug('tlb-abi:internal')
const debugJetton = debug('tlb-abi:jetton')

// Precalculated lookup maps - maps opCodes to array indices
/* __INTERNAL_PARSER_MAP__START__ */
const internalParserMap: { [opCode: string]: number[] } = {
  0x5c11ada9: [0],
};
/* __INTERNAL_PARSER_MAP__END__ */

/* __JETTON_PAYLOAD_PARSER_MAP__START__ */
const jettonPayloadParserMap: { [opCode: string]: number[] } = {
  0xe3a0d482: [0],
};
/* __JETTON_PAYLOAD_PARSER_MAP__END__ */
/* __PARSED_INTERNAL__START__ */
export type ParsedInternal = {
  opCode: 0x5c11ada9
  schema: 'daolama'
  internal: 'daolama_vault_supply'
  boc: Buffer
  data: ReturnType<typeof loadDaolamaDaolamaVaultSupply>
}
/* __PARSED_INTERNAL__END__ */

/* __PARSED_JETTON_PAYLOAD__START__ */
export type ParsedJettonPayload = {
  opCode: 0xe3a0d482
  schema: 'dedust'
  payload: 'dedust_swap'
  boc: Buffer
  data: ReturnType<typeof loadDedustJettonDedustSwap>
}
/* __PARSED_JETTON_PAYLOAD__END__ */
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

/**
 * Runtime function that replaces JettonPayload instances with JettonPayloadWithParsed
 * If the object has JettonPayload children - replace only it, otherwise return original object
 */
export function replaceJettonPayload<T extends ParsedInternal>(obj: T): {
  data: ReplaceJettonPayload<T>
  hasChanges: boolean
 } {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return {
      data: obj,
      hasChanges: false
    }
  }

  // Direct JettonPayload case
  if (obj instanceof Object && 'kind' in obj && obj.kind === 'JettonPayload') {
    try {
      const slice = (obj.data as any).asSlice()
      const payload = parseJettonPayload(slice as any)
      if (payload) {
        (obj as any)['parsed'] = payload // ts-ignore
      }
      return {
        data: obj as unknown as JettonPayloadWithParsed as unknown as ReplaceJettonPayload<T>,
        hasChanges: true
      }
    } catch (e) {
      // Not a valid Jetton payload, leave as is
    }
    return {
      data: obj as unknown as JettonPayloadWithParsed as unknown as ReplaceJettonPayload<T>,
      hasChanges: false
    }
  }
  
  // Array case
  if (Array.isArray(obj)) {
    const replaced = obj.map(item => replaceJettonPayload(item))
    const hasChanges = replaced.some(item => item.hasChanges)
    return {
      data: hasChanges 
        ? replaced.map(item => item.data) as unknown as ReplaceJettonPayload<T> 
        : obj as unknown as ReplaceJettonPayload<T>,
      hasChanges: hasChanges
    }
  }
  
  // Regular object case
  let hasChanges = false;
  const result = {...obj} as any;
  
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const {data, hasChanges: hasChangesInner} = replaceJettonPayload((obj as any)[key]);
      if (hasChangesInner) {
        hasChanges = true;
        result[key] = data;
      }
    }
  }
  
  // Return original object if no changes were made
  return {
    data: hasChanges ? result as unknown as ReplaceJettonPayload<T> : obj as unknown as ReplaceJettonPayload<T>,
    hasChanges: hasChanges
  }
}

export function parseWithPayloads<T extends ParsedInternal>(cs: Slice): ReplaceJettonPayload<T> | undefined {
  const internal = parseInternal(cs) as T
  if (!internal) {
    return undefined
  }

  return replaceJettonPayload(internal).data
}