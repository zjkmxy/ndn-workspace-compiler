import { Endpoint } from 'npm:@ndn/endpoint'
import { UnixTransport } from "npm:@ndn/node-transport"
import { FwTracer } from "npm:@ndn/fw"
import { fetch, serve } from "npm:@ndn/segmented-object"
import { Interest, Name, digestSigning } from "npm:@ndn/packet"
import { enableNfdPrefixReg } from "npm:@ndn/nfdmgmt"
import { FileChunkSource } from './file-chunk-source.ts'
import { Encoder } from "npm:@ndn/tlv";

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

  const zipServer = serve(reqName, new FileChunkSource(filePath))

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

    Deno.writeFile('./result.pdf', pdfContent)
  }

  zipServer.close()
  nfdFace.close()
}
