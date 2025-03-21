export function toCamelCase(str: string) {
    return str.replace(/_([a-zA-Z])/g, function (g) {
      return g[1].toUpperCase();
    });
  }


export function toPascalCase(string: string) {
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
  