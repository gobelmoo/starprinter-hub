export const runtime = 'nodejs';

// Star printer fetches this on setup to learn server capability.
// Spec: https://star-m.jp/products/s_print/sdk/StarCloudPRNT/manual/en/
export const GET = () =>
  Response.json({
    title: 'star_cloudprnt_server_setting',
    version: '1.0.0',
    serverSupportProtocol: ['HTTP'],
  });
