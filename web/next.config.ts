import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Bundle the cputil Linux binary into the cloudprnt API function so that the
  // Vercel runtime can spawn it for markup → StarPRNT conversion.
  outputFileTracingIncludes: {
    'app/api/cloudprnt/route': ['./bin/cputil-linux-x64'],
  },
};

export default nextConfig;
