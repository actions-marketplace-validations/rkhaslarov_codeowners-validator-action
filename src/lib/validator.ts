import * as core from '@actions/core'
import * as fs from 'fs'
import * as readline from 'readline'

const fsAsync = fs.promises

type Structure = Record<string, any>

function fillWithPath(structure: Structure, path: string): Structure {
  const [, ...arrayPath] = path.split('/')

  return arrayPath.reduce((acc: Structure, folderName, idx) => {
    if (!acc[folderName]) {
      acc[folderName] = {}
    }

    if (idx === arrayPath.length - 1) {
      acc[folderName].owned = true
    }

    return acc[folderName]
  }, structure)
}

async function getOwnedFilePaths(codeOwnersFilePath: string): Promise<{
  ownedFileEndings: string[]
  ownersStructure: Structure
}> {
  const ownersStructure = {}
  const ownedFileEndings = []

  const fileStream = fs.createReadStream(codeOwnersFilePath)
  const readLinesStream = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  })

  for await (const line of readLinesStream) {
    if (!line.startsWith('#') && line.length) {
      const [path] = line.split(' ')

      if (path.includes('*')) {
        const fileEnding = path.split('*')[1]

        ownedFileEndings.push(fileEnding)
      } else if (path.includes('/')) {
        fillWithPath(ownersStructure, path)
      }
    }
  }

  return {
    ownedFileEndings,
    ownersStructure
  }
}

async function deepScanDirectory(path: string): Promise<string[]> {
  const items = await fsAsync.readdir(path, {withFileTypes: true})

  const dirItems = items.filter(item => item.isDirectory())

  const childItems = await Promise.all(
    dirItems.map(async dirItem => deepScanDirectory(`${path}/${dirItem.name}`))
  )

  return [
    ...dirItems.map(dirItem => `${path}/${dirItem.name}`),
    ...childItems
  ].flat()
}

async function scanExistingFiles(folders: string[]): Promise<string[]> {
  const dirItems = await Promise.all(
    folders.map(async path => deepScanDirectory(path))
  )

  return dirItems.flat()
}

async function validateCodeOwners(
  codeOwnersFilePath: string,
  folders: string[]
): Promise<void> {
  const [{ownedFileEndings, ownersStructure}, filePaths] = await Promise.all([
    getOwnedFilePaths(codeOwnersFilePath),
    scanExistingFiles(folders)
  ])

  core.info(JSON.stringify(ownedFileEndings))
  core.info(JSON.stringify(ownersStructure))
  core.info(filePaths.toString())

  const unownedFiles = filePaths.filter((filePath: string) => {
    if (
      ownedFileEndings.some(
        fileEnding => fileEnding && filePath.endsWith(fileEnding)
      )
    ) {
      return false
    }

    const [, ...path] = filePath.split('/')

    let currentFolder = ownersStructure

    for (let i = 0; i < path.length; i += 1) {
      if (currentFolder.owned) {
        return false
      }

      if (currentFolder[path[i]]) {
        currentFolder = currentFolder[path[i]]
      } else {
        return true
      }
    }

    return false
  })

  core.info(unownedFiles.toString())

  if (unownedFiles.length) {
    throw new Error(
      `The next folders do not have owners: ${unownedFiles.join('\n')}`
    )
  }
}

export default validateCodeOwners
