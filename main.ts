import { path } from "./dep.ts"
import { Endpoint } from '@ndn/endpoint'
import { UnixTransport } from "@ndn/node-transport"
import { FwTracer } from "@ndn/fw"
import { Data, Interest, Name, digestSigning } from "@ndn/packet"
import { Decoder } from "@ndn/tlv"
import * as segobj from "@ndn/segmented-object"
import { enableNfdPrefixReg } from "@ndn/nfdmgmt"

const texCommands = [
  { cmd: 'pdflatex', args: ['-shell-escape', '-interaction=nonstopmode', 'main.tex'] },
  { cmd: 'bibtex', args: ['main'] },
  { cmd: 'pdflatex', args: ['-shell-escape', '-interaction=nonstopmode', 'main.tex'] },
  { cmd: 'pdflatex', args: ['-shell-escape', '-interaction=nonstopmode', 'main.tex'] },
]
let servers: Array<segobj.Server> = []

const runOn = async (reqId: string, zipContent: Uint8Array) => {
  const dirPath = path.join(Deno.cwd(), 'uploaded', reqId)
  const zipPath = path.join(Deno.cwd(), 'uploaded', `${reqId}.zip`)
  await Deno.writeFile(zipPath, zipContent, { create: true })

  const unzipCmd = new Deno.Command('unzip', {
    args: ['-o', zipPath, '-d', dirPath],
    stdout: "piped",
    stderr: "piped"
  })
  let cmdOutput = await unzipCmd.output()
  if (cmdOutput.code !== 0) {
    return {
      'id': reqId,
      'status': 'error',
      'returnCode': cmdOutput.code,
      'stdout': new TextDecoder().decode(cmdOutput.stdout),
      'stderr': new TextDecoder().decode(cmdOutput.stderr),
    }
  }

  for (const cmdParam of texCommands) {
    const execCmd = new Deno.Command(cmdParam.cmd, {
      args: cmdParam.args,
      stdout: "piped",
      stderr: "piped",
      cwd: dirPath,
    })
    cmdOutput = await execCmd.output()
  }

  if (cmdOutput.code !== 0) {
    return {
      'id': reqId,
      'status': 'error',
      'returnCode': cmdOutput.code,
      'stdout': new TextDecoder().decode(cmdOutput.stdout),
      'stderr': new TextDecoder().decode(cmdOutput.stderr),
    }
  }

  const cpCmd = new Deno.Command('cp', {
    args: [`${dirPath}/main.pdf`, `uploaded/${reqId}.pdf`],
    stdout: "null",
    stderr: "null"
  })
  await cpCmd.output()
  return {
    'id': reqId,
    'status': 'success',
    'returnCode': cmdOutput.code,
    'stdout': new TextDecoder().decode(cmdOutput.stdout),
    'stderr': new TextDecoder().decode(cmdOutput.stderr),
  }
}

const requestHandler = async (interest: Interest) => {
  const nameWire = interest.appParameters
  if (!nameWire) {
    return
  }
  const name = Name.decodeFrom(new Decoder(nameWire))
  // Fetch for input

  console.log(`Go fetching ${name.toString()}`)
  const zipContent = await segobj.fetch(name, {
    modifyInterest: { mustBeFresh: true },
    lifetimeAfterRto: 2000,
  })

  // Execute
  const reqId = crypto.randomUUID()
  const result = await runOn(reqId, zipContent)
  const retText = JSON.stringify(result)
  const retWire = new TextEncoder().encode(retText)

  // TODO: THIS DOES NOT SCALE. There must be one producer handling all results, not one for each.
  // TODO: schedule delete them after some time
  // TODO: Does NDNts allows to give a signer?

  const fileContent = await Deno.readFile(`uploaded/${reqId}.pdf`)
  const chunkSource = new segobj.BufferChunkSource(fileContent)
  const server = segobj.serve(
    new Name(`/ndn/workspace-compiler/result/${reqId}`),
    chunkSource,
    { announcement: false }
  )
  const len = servers.push(server)
  if (len > 10) {
    servers[0].close()
    servers = servers.slice(1)
  }

  return new Data(interest.name, Data.FreshnessPeriod(5000), retWire)
}

// Learn more at https://deno.land/manual/examples/module_metadata#concepts
if (import.meta.main) {
  FwTracer.enable()

  const endpoint = new Endpoint()
  const nfdFace = await UnixTransport.createFace({}, '/run/nfd.sock')
  enableNfdPrefixReg(nfdFace, {
    signer: digestSigning,
  })

  const prefixRegister = endpoint.produce('/ndn/workspace-compiler', () => new Promise(() => undefined), {
    routeCapture: false,
  })
  const reqHandler = endpoint.produce('/ndn/workspace-compiler/request', requestHandler, {
    dataSigner: digestSigning,
    announcement: false,
  })
  // const resHandler = endpoint.produce('/ndn/workspace-compiler/result', resultHandler, {})

  Deno.addSignalListener("SIGINT", () => {
    console.log("Stopped by Ctrl+C")
    // resHandler.close()
    for (const server of servers) {
      server.close()
    }
    reqHandler.close()
    prefixRegister.close()
    nfdFace.close()
    Deno.exit()
  })
}
