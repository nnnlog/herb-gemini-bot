# 1. 베이스 이미지 선택 (Node.js 22 LTS)
FROM node:22

# 2. pnpm 활성화 (Node.js에 내장된 corepack 사용)
RUN corepack enable

# 3. 컨тей너 내 작업 디렉터리 설정
WORKDIR /usr/src/app

# 4. 의존성 설치를 위해 package.json과 pnpm-lock.yaml을 먼저 복사
COPY package.json pnpm-lock.yaml ./

# 5. pnpm을 사용하여 프로덕션 의존성 설치
RUN npm install --omit=dev

# 6. 나머지 소스 코드를 작업 디렉터리로 복사
COPY . .

# 7. 컨тей너가 시작될 때 실행할 명령어 정의
CMD ["node", "bot.js"]
