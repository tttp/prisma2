import { getPlatform } from '@prisma/get-platform'
import chalk from 'chalk'
import execa from 'execa'
import path from 'path'
import { ConfigMetaFormat } from './isdlToDatamodel2'
import { DMMF } from '@prisma/generator-helper'
import tmpWrite from 'temp-write'
import fs from 'fs'
import { promisify } from 'util'
import Debug from 'debug'
const debug = Debug('engineCommands')

const unlink = promisify(fs.unlink)

const MAX_BUFFER = 1000 * 1000 * 1000

async function getPrismaPath(): Promise<string> {
  // tslint:disable-next-line
  const dir = eval('__dirname')
  const platform = await getPlatform()
  const extension = platform === 'windows' ? '.exe' : ''
  const relative = `../query-engine-${platform}${extension}`
  return path.join(dir, relative)
}

export type GetDMMFOptions = {
  datamodel: string
  cwd?: string
  prismaPath?: string
  datamodelPath?: string
  retry?: number
}

export async function getDMMF({
  datamodel,
  cwd = process.cwd(),
  prismaPath,
  datamodelPath,
  retry = 4,
}: GetDMMFOptions): Promise<DMMF.Document> {
  prismaPath = prismaPath || (await getPrismaPath())
  let result
  try {
    let tempDataModelPath: string
    try {
      tempDataModelPath = await tmpWrite(datamodel)
    } catch (err) {
      throw new Error(
        chalk.redBright.bold('Get DMMF ') +
          'unable to write temp data model path',
      )
    }

    result = await execa(prismaPath, ['cli', '--dmmf'], {
      cwd,
      env: {
        ...process.env,
        PRISMA_DML_PATH: tempDataModelPath,
        RUST_BACKTRACE: '1',
      },
      maxBuffer: MAX_BUFFER,
    })

    await unlink(tempDataModelPath)

    if (result.stdout.includes('Please wait until the') && retry > 0) {
      debug('Retrying after "Please wait until"')
      await new Promise(r => setTimeout(r, 5000))
      return getDMMF({
        datamodel,
        cwd,
        prismaPath,
        datamodelPath,
        retry: retry - 1,
      })
    }

    return JSON.parse(result.stdout)
  } catch (e) {
    // If this unlikely event happens, try it at least once more
    if (
      e.message.includes('Command failed with exit code 26 (ETXTBSY)') &&
      retry > 0
    ) {
      await new Promise(resolve => setTimeout(resolve, 500))
      debug('Retrying after ETXTBSY')
      return getDMMF({
        datamodel,
        cwd,
        prismaPath,
        datamodelPath,
        retry: retry - 1,
      })
    }
    if (e.stderr) {
      throw new Error(chalk.redBright.bold('Schema parsing ') + e.stderr)
    }
    if (e.message.includes('in JSON at position')) {
      throw new Error(
        `Problem while parsing the query engine response at ${prismaPath}. ${result.stdout}\n${e.stack}`,
      )
    }
    throw new Error(e)
  }
}

export async function getConfig({
  datamodel,
  cwd = process.cwd(),
  prismaPath,
  datamodelPath,
}: GetDMMFOptions): Promise<ConfigMetaFormat> {
  prismaPath = prismaPath || (await getPrismaPath())

  let tempDataModelPath: string
  try {
    tempDataModelPath = await tmpWrite(datamodel)
  } catch (err) {
    throw new Error(
      chalk.redBright.bold('Get config ') +
        'unable to write temp data model path',
    )
  }

  try {
    const result = await execa(
      prismaPath,
      ['cli', '--get_config', tempDataModelPath],
      {
        cwd,
        env: {
          ...process.env,
          PRISMA_DML_PATH: tempDataModelPath,
          RUST_BACKTRACE: '1',
        },
        maxBuffer: MAX_BUFFER,
      },
    )

    await unlink(tempDataModelPath)

    return JSON.parse(result.stdout)
  } catch (e) {
    if (e.stderr) {
      throw new Error(chalk.redBright.bold('Get config ') + e.stderr)
    }
    if (e.stdout) {
      throw new Error(chalk.redBright.bold('Get config ') + e.stdout)
    }
    throw new Error(chalk.redBright.bold('Get config ') + e)
  }
}

export interface WholeDmmf {
  dmmf: DMMF.Datamodel
  config: ConfigMetaFormat
}

export async function dmmfToDml(
  input: WholeDmmf,
  prismaPath?: string,
): Promise<string> {
  prismaPath = prismaPath || (await getPrismaPath())

  const filePath = await tmpWrite(JSON.stringify(input))
  try {
    const args = ['cli', '--dmmf_to_dml', filePath]
    debug(args)
    const result = await execa(prismaPath, args, {
      env: {
        ...process.env,
        RUST_BACKTRACE: '1',
      },
      maxBuffer: MAX_BUFFER,
    })

    await unlink(filePath)

    return result.stdout
  } catch (e) {
    if (e.stderr) {
      throw new Error(chalk.redBright.bold('DMMF To DML ') + e.stderr)
    }
    throw new Error(e)
  }
}
