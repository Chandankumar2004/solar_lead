Start-Process -FilePath "cmd.exe" -ArgumentList '/c cd /d D:/Solar_Lead && pnpm --dir apps/api exec tsx src/index.ts' -WindowStyle Hidden
