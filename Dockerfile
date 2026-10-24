# 공개판 웹(web/) 운영 이미지. Cloudflare Containers(cloudflare/)가 이 이미지를 띄운다.
# 빌드 루트는 저장소 루트다: web 이 core/ 를 바로 가져오고, 빌드 전에 prompts/(비공개 서브모듈)로 내장본을 만든다.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# 루트 postinstall 은 prompts/ 가 있어야 돌아서 여기서는 건너뛰고, web 빌드 전(prebuild)에 만든다
RUN npm ci --ignore-scripts
COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci
COPY . .
RUN test -f prompts/interviewer_doc_screening.md || (echo "prompts/ 서브모듈이 없습니다 (git submodule update --init)" && exit 1)
RUN cd web && npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3100 HOSTNAME=0.0.0.0
COPY --from=build /app/web/.next/standalone ./
COPY --from=build /app/web/.next/static ./web/.next/static
COPY --from=build /app/web/public ./web/public
COPY --from=build /app/web/supabase ./web/supabase
WORKDIR /app/web
USER node
EXPOSE 3100
CMD ["node", "server.js"]
