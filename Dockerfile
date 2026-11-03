# One image, run as two services with different accounts: see compose.yaml. It holds no records and no secrets.
# Base images are pinned by digest and Python packages by hash, so a rebuild gets the same software.
FROM node:22-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS web
WORKDIR /build
COPY package.json package-lock.json tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm ci --ignore-scripts --no-audit --no-fund && npm run build

FROM python:3.11-slim@sha256:db20d8506e2f15b6db39b40b6015ca46bae855dec6dd326d462cfe79ae972893
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY backend/requirements.prod.lock /tmp/requirements.lock
RUN pip install --no-cache-dir --no-compile --require-hashes -r /tmp/requirements.lock && rm /tmp/requirements.lock
# In site-packages because the reader starts Python with -I, which ignores PYTHONPATH and the working directory.
COPY backend/this_is_you /usr/local/lib/python3.11/site-packages/this_is_you
COPY --from=web /build/dist /app/web
RUN chmod -R a-w /app /usr/local/lib/python3.11/site-packages/this_is_you
WORKDIR /app
# compose.yaml sets the real accounts. This is so nothing runs as root by accident.
USER 65534:65534
