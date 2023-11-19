import { Endpoint } from 'npm:@ndn/endpoint'
import { WsTransport } from "npm:@ndn/ws-transport"
import { encodeBase64 } from "std/encoding/base64.ts"
import * as path from "std/path/mod.ts"
import { FwTracer } from "npm:@ndn/fw"
import { Interest } from "npm:@ndn/packet"
import { fchQuery } from "npm:@ndn/autoconfig"

const texCommands = [
  { cmd: 'pdflatex', args: ['-shell-escape', '-interaction=nonstopmode', 'main.tex'] },
  { cmd: 'bibtex', args: ['main'] },
  { cmd: 'pdflatex', args: ['-shell-escape', '-interaction=nonstopmode', 'main.tex'] },
  { cmd: 'pdflatex', args: ['-shell-escape', '-interaction=nonstopmode', 'main.tex'] },
]

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

  if(cmdOutput.code !== 0) {
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
}

const responseHandler = async (interest: Interest) => {
}

// Learn more at https://deno.land/manual/examples/module_metadata#concepts
if (import.meta.main) {
  // FwTracer.enable()

  // const fchRes = await fchQuery({
  //   transport: 'wss',
  //   position: [
  //     -118,
  //     34,
  //   ]
  // })
  // console.log(fchRes.routers[0])

  // const endpoint = new Endpoint()
  // const nfdWsFace = await WsTransport.createFace({ l3: { local: false } }, fchRes.routers[0].connect)

  // const data = await endpoint.consume(new Interest('/yoursunny/_/ley/ping/4', Interest.CanBePrefix))

  // const nameStr = (await data.computeFullName()).toString()
  // const result = encodeBase64(data.content)
  // console.log(nameStr)
  // console.log(result)

  // nfdWsFace.close()
}
