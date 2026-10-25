import { ListObjectsV2Command } from '@aws-sdk/client-s3'

// Completar la enumeración antes de permitir decisiones de retención.
export async function listAllObjects(client, input) {
  const objects = []
  const seen = new Set()
  let token
  do {
    const result = await client.send(new ListObjectsV2Command({
      ...input,
      ...(token ? { ContinuationToken: token } : {}),
    }))
    objects.push(...(result.Contents || []))
    if (!result.IsTruncated) return objects
    token = result.NextContinuationToken
    if (typeof token !== 'string' || !token || seen.has(token)) {
      throw new Error('S3 returned an invalid continuation token')
    }
    seen.add(token)
  } while (true)
}
