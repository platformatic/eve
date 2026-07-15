import { withEve } from 'eve/next'

const eveOrigin = `http://127.0.0.1:${process.env.EVE_NEXT_PRODUCTION_PORT ?? '4274'}`
const publicBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

/** @type {import('next').NextConfig} */
const nextConfig = {
  assetPrefix: publicBasePath,
  async rewrites () {
    return {
      beforeFiles: [{
        source: '/.well-known/workflow/:path+',
        destination: `${eveOrigin}/.well-known/workflow/:path+`
      }]
    }
  }
}

export default withEve(nextConfig)
