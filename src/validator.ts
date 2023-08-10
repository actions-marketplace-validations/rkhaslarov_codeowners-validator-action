import {promises as fs} from 'fs'

function fillWithPath(structure, path) {
  const [, ...arrayPath] = path.split('/')

  return arrayPath.reduce((acc, folderName, idx) => {
    if (!acc[folderName]) {
      acc[folderName] = {}
    }

    if (idx === arrayPath.length - 1) {
      acc[folderName].owned = true
    }

    return acc[folderName]
  }, structure)
}

async function getOwnedFilePaths(codeOwnersFilePath) {
  const ownersStructure = {}
  const ownedFileEndings = []

  const file = await fs.open(codeOwnersFilePath)

  const readLinesStream = file.readLines()

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

async function deepScanDirectory(path): Promise<string[]> {
  const items = await fs.readdir(path, {withFileTypes: true})

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
) {
  const [{ownedFileEndings, ownersStructure}, filePaths] = await Promise.all([
    getOwnedFilePaths(codeOwnersFilePath),
    scanExistingFiles(folders)
  ])

  const unownedFiles = filePaths.filter(filePath => {
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

  if (unownedFiles.length) {
    throw new Error(
      `The next folders do not have owners: ${unownedFiles.join('\n')}`
    )
  }
}

export default validateCodeOwners
