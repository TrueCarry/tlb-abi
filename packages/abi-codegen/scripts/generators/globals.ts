import { generateCodeFromData } from '@ton-community/tlb-codegen'
import fs from 'fs/promises'
import { resolve } from "path";
import * as ts from 'typescript';

export const globalTypes = `
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

export async function getGlobalIdentifiers(): Promise<string[]> {
  const globalTypesTlb = await generateCodeFromData(globalTypes, 'typescript')
  await fs.writeFile(resolve(__dirname, `../../build/globals.ts`), globalTypesTlb)
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
  return globalIdentifiers
}