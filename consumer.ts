import { Endpoint } from '@ndn/endpoint'
import { UnixTransport } from "@ndn/node-transport"
import { FwTracer } from "@ndn/fw"
import { fetch, serve, BufferChunkSource } from "@ndn/segmented-object"
import { Interest, Name, digestSigning } from "@ndn/packet"
import { enableNfdPrefixReg } from "@ndn/nfdmgmt"
import { Encoder } from "@ndn/tlv"

if (import.meta.main) {
  FwTracer.enable()

  const endpoint = new Endpoint()
  const nfdFace = await UnixTransport.createFace({}, '/run/nfd.sock')
  enableNfdPrefixReg(nfdFace, {
    signer: digestSigning,
  })

  const filePath = Deno.args[0]
  const reqName = new Name(`/ndn/compiler-tester/${filePath}`)
  const reqNameEncoder = new Encoder()
  reqName.encodeTo(reqNameEncoder)

  const fileContent = await Deno.readFile(filePath)
  const chunkSource = new BufferChunkSource(fileContent)
  const zipServer = serve(reqName, chunkSource)

  const interest = new Interest(
    '/ndn/workspace-compiler/request',
    Interest.MustBeFresh,
    Interest.Lifetime(60000),
    reqNameEncoder.output,
  )
  await digestSigning.sign(interest)
  const retWire = await endpoint.consume(interest)
  const retText = new TextDecoder().decode(retWire.content)
  const result = JSON.parse(retText)

  if (result.status === 'error') {
    console.error('Request failed')
    console.log(result.stdout)
    console.log(result.stderr)
  } else {
    console.error('Request finished')
    const reqId = result.id
    const pdfContent = await fetch(`/ndn/workspace-compiler/result/${reqId}`)

    Deno.writeFile('./temp/result.pdf', pdfContent)
  }

  zipServer.close()
  nfdFace.close()
}
