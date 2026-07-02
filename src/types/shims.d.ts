declare const process: {
  env: Record<string, string | undefined>;
};

declare module 'fastify' {
  const Fastify: any;
  export default Fastify;
}

declare module '@fastify/cors' {
  const cors: any;
  export default cors;
}

declare module 'zod' {
  export const z: any;
}
