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