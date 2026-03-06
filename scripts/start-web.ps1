Start-Process -FilePath "cmd.exe" -ArgumentList '/c cd /d D:/Solar_Lead && pnpm --filter @solar/web dev -p 3200' -WindowStyle Hidden
