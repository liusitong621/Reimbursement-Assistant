async function fileToImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = URL.createObjectURL(file)
  })
}

export type PreparedImageFile = {
  file: File
  compressed: boolean
  originalSize: number
  finalSize: number
}

export function formatFileSize(size: number) {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(2)} MB`
  }

  return `${(size / 1024).toFixed(0)} KB`
}

export async function compressImageIfNeeded(file: File): Promise<PreparedImageFile> {
  const maxSize = 10 * 1024 * 1024
  if (file.size <= maxSize || !file.type.startsWith('image/')) {
    return {
      file,
      compressed: false,
      originalSize: file.size,
      finalSize: file.size,
    }
  }

  const image = await fileToImage(file)
  const canvas = document.createElement('canvas')
  const scale = Math.sqrt(maxSize / file.size)
  canvas.width = Math.max(960, Math.floor(image.width * scale))
  canvas.height = Math.max(960, Math.floor(image.height * scale))
  const context = canvas.getContext('2d')

  if (!context) {
    return {
      file,
      compressed: false,
      originalSize: file.size,
      finalSize: file.size,
    }
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.82)
  })

  if (!blob) {
    return {
      file,
      compressed: false,
      originalSize: file.size,
      finalSize: file.size,
    }
  }

  const compressedFile = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
    type: 'image/jpeg',
  })

  return {
    file: compressedFile,
    compressed: true,
    originalSize: file.size,
    finalSize: compressedFile.size,
  }
}
