@echo off
chcp 65001 > nul
color 0A
title GERENCIADOR DA VPS - ORACLE CLOUD

rem =====================================================================
rem Edite estas 5 linhas para o seu ambiente antes de usar.
rem =====================================================================
set IP=147.15.110.106
set USER=ubuntu
set KEY=C:\Users\Heberson\Downloads\ssh-key-2026-08-01.key
set PROJETO=~/whatsatendende
set REPO_WHATSATENDENDE=https://github.com/Heberson5/WhatsAtendende.git
set PROJETO2=~/treinamentos
set ENVTREINO=C:\Users\Heberson\Documents\GitHub\treinamentos\.env

:MENU
cls
echo ============================================================
echo              GERENCIADOR DA VPS ORACLE CLOUD
echo ============================================================
echo.
echo Servidor : %IP%
echo Projeto  : WhatsAtendende
echo.
echo ============================================================
echo.
echo   [1] Atualizar Sistema (Git Pull + Docker Build)
echo   [2] Conectar via SSH
echo   [3] Ver Containers
echo   [4] Reiniciar Sistema
echo   [5] Ver Logs
echo   [6] Status do Docker
echo   [7] Uso de CPU / RAM / Disco
echo   [8] Atualizar Ubuntu
echo   [9] Reiniciar VPS
echo  [10] Abrir Sistema no Navegador
echo  [11] Docker Compose Down
echo  [12] Docker Compose Up
echo  [13] Instalar Docker e Docker Compose
echo  [14] Preparar VPS para Aplicação
echo  [15] Deploy/Atualizar WhatsAtendende
echo  [16] Deploy/Atualizar Treinamentos
echo  [17] Abrir Treinamentos no Navegador
echo  [18] Criar Swap (4GB) - Corrige falta de memoria
echo  [19] Ver docker-compose.yml do WhatsAtendende
echo  [20] Ver .env/commit/bundle do Treinamentos
echo  [21] Popular usuários iniciais do WhatsAtendende (seed)
echo  [22] Remover Chamados do VPS (containers + pasta)
echo.
echo   [0] Sair
echo.
set /p op=Escolha uma opção:

if "%op%"=="1" goto UPDATE
if "%op%"=="2" goto SSH
if "%op%"=="3" goto PS
if "%op%"=="4" goto RESTART
if "%op%"=="5" goto LOGS
if "%op%"=="6" goto STATUS
if "%op%"=="7" goto MONITOR
if "%op%"=="8" goto UPGRADE
if "%op%"=="9" goto REBOOT
if "%op%"=="10" goto SITE
if "%op%"=="11" goto DOWN
if "%op%"=="12" goto UP
if "%op%"=="13" goto INSTALL_DOCKER
if "%op%"=="14" goto PREPARE
if "%op%"=="15" goto DEPLOY_WHATSATENDENDE
if "%op%"=="16" goto DEPLOY_TREINAMENTOS
if "%op%"=="17" goto SITE_TREINO
if "%op%"=="18" goto SWAP
if "%op%"=="19" goto CATCOMPOSE
if "%op%"=="20" goto CATENV
if "%op%"=="21" goto SEED_WHATSATENDENDE
if "%op%"=="22" goto REMOVE_CHAMADOS
if "%op%"=="0" exit

goto MENU

:UPDATE
cls
echo Atualizando projeto...
ssh -i "%KEY%" %USER%@%IP% "cd %PROJETO% && git pull && docker compose up -d --build"
pause
goto MENU

:SSH
cls
ssh -i "%KEY%" %USER%@%IP%
goto MENU

:PS
cls
ssh -i "%KEY%" %USER%@%IP% "docker ps -a"
pause
goto MENU

:RESTART
cls
ssh -i "%KEY%" %USER%@%IP% "cd %PROJETO% && docker compose restart"
pause
goto MENU

:LOGS
cls
ssh -i "%KEY%" %USER%@%IP% "cd %PROJETO% && docker compose logs --tail=100"
pause
goto MENU

:STATUS
cls
ssh -i "%KEY%" %USER%@%IP% "sudo systemctl status docker --no-pager"
pause
goto MENU

:MONITOR
cls
ssh -i "%KEY%" %USER%@%IP% "echo ===== CPU ===== && top -bn1 | head -5 && echo. && echo ===== MEMORIA ===== && free -h && echo. && echo ===== DISCO ===== && df -h"
pause
goto MENU

:UPGRADE
cls
ssh -i "%KEY%" %USER%@%IP% "sudo apt update && sudo apt upgrade -y"
pause
goto MENU

:REBOOT
cls
echo.
set /p resp=Tem certeza que deseja reiniciar a VPS? (S/N):
if /I "%resp%"=="S" (
    ssh -i "%KEY%" %USER%@%IP% "sudo reboot"
)
pause
goto MENU

:SITE
start http://%IP%:8080
goto MENU

:DOWN
cls
ssh -i "%KEY%" %USER%@%IP% "cd %PROJETO% && docker compose down"
pause
goto MENU

:UP
cls
ssh -i "%KEY%" %USER%@%IP% "cd %PROJETO% && docker compose up -d"
pause
goto MENU

:INSTALL_DOCKER
cls
echo =====================================================
echo Instalando Docker...
echo =====================================================

ssh -i "%KEY%" %USER%@%IP% "sudo apt update && sudo apt install -y apt-transport-https ca-certificates curl software-properties-common git unzip && curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker %USER% && sudo systemctl enable docker && sudo systemctl start docker && docker --version && docker compose version"

echo.
echo Docker instalado com sucesso.
echo.
pause
goto MENU

:PREPARE
cls
echo =====================================================
echo Preparando VPS...
echo =====================================================

ssh -i "%KEY%" %USER%@%IP% "sudo apt update && sudo apt upgrade -y && sudo apt install -y git curl unzip wget htop nano jq build-essential net-tools ufw && sudo timedatectl set-timezone America/Cuiaba && mkdir -p %PROJETO% && sudo systemctl restart docker && docker info"

echo.
echo VPS preparada.
echo.
pause
goto MENU

:DEPLOY_WHATSATENDENDE
cls
echo ===================================================
echo Deploy/Atualizar WhatsAtendende...
echo ===================================================
echo.
echo OBS: o Dockerfile da API roda "prisma migrate deploy"
echo automaticamente antes de subir - nao precisa rodar migration
echo a parte.
echo.
echo Se for o PRIMEIRO deploy, um .env com segredos aleatorios
echo (JWT) sera criado direto na VPS, com WHATSAPP_PROVIDER=baileys
echo (conexao real). Depois do deploy, entre em Configuracoes no
echo sistema e conecte o WhatsApp (QR Code ou codigo de pareamento).
echo.

ssh -i "%KEY%" %USER%@%IP% "if [ -d %PROJETO%/.git ]; then cd %PROJETO% && git pull; else rm -rf %PROJETO% && git clone %REPO_WHATSATENDENDE% %PROJETO%; fi && cd %PROJETO% && if [ ! -f .env ]; then echo 'Criando .env com segredos novos (primeiro deploy)...'; { echo JWT_ACCESS_SECRET=$(openssl rand -hex 32); echo JWT_REFRESH_SECRET=$(openssl rand -hex 32); echo WHATSAPP_PROVIDER=baileys; echo WEB_APP_URL=http://%IP%:8080; } > .env; echo '.env criado - faca um backup deste arquivo (nao esta no git, sem ele os logins existentes param de funcionar num redeploy que o apague).'; fi && docker compose up -d --build"

echo.
echo WhatsAtendende atualizado e no ar em http://%IP%:8080
echo.
echo Se ainda nao existe nenhum usuario cadastrado (primeiro deploy),
echo use a opcao [21] para criar os usuarios iniciais e depois troque
echo as senhas padrao em Usuarios.
echo.
pause
goto MENU

:SEED_WHATSATENDENDE
cls
echo ===================================================
echo Populando usuarios iniciais do WhatsAtendende...
echo ===================================================
echo.
echo Cria/atualiza um admin, um gestor e dois atendentes de
echo exemplo com senhas padrao (ver README) - troque essas senhas
echo em Usuarios assim que acessar. Seguro rodar mais de uma vez:
echo nao sobrescreve a senha de um usuario ja existente.
echo.

ssh -i "%KEY%" %USER%@%IP% "cd %PROJETO% && docker compose exec -T api npm run prisma:seed"

pause
goto MENU

:DEPLOY_TREINAMENTOS
cls
echo ===================================================
echo Deploy/Atualizar Treinamentos...
echo ===================================================

ssh -i "%KEY%" %USER%@%IP% "if [ -d ~/treinamentos/.git ]; then cd ~/treinamentos && git pull; else rm -rf ~/treinamentos && git clone https://github.com/Heberson5/treinamentos.git ~/treinamentos; fi"

echo Enviando .env (nao versionado no git) para a VPS...
scp -i "%KEY%" "%ENVTREINO%" %USER%@%IP%:~/treinamentos/.env

ssh -i "%KEY%" %USER%@%IP% "cd ~/treinamentos && echo RlJPTSBub2RlOjIwLXNsaW0gQVMgYnVpbGQKV09SS0RJUiAvYXBwCkNPUFkgcGFja2FnZSouanNvbiAuLwpSVU4gbnBtIGluc3RhbGwKQ09QWSAuIC4KRU5WIE5PREVfT1BUSU9OUz0tLW1heC1vbGQtc3BhY2Utc2l6ZT0xNTM2ClJVTiBucG0gcnVuIGJ1aWxkCgpGUk9NIG5naW54OnN0YWJsZS1hbHBpbmUKQ09QWSAtLWZyb209YnVpbGQgL2FwcC9kaXN0IC91c3Ivc2hhcmUvbmdpbngvaHRtbApDT1BZIG5naW54LmNvbmYgL2V0Yy9uZ2lueC9jb25mLmQvZGVmYXVsdC5jb25mCkVYUE9TRSA4MApDTUQgWyJuZ2lueCIsICItZyIsICJkYWVtb24gb2ZmOyJdCg== | base64 -d > Dockerfile && echo c2VydmVyIHsKICAgIGxpc3RlbiA4MDsKICAgIHNlcnZlcl9uYW1lIF87CiAgICByb290IC91c3Ivc2hhcmUvbmdpbngvaHRtbDsKICAgIGluZGV4IGluZGV4Lmh0bWw7CiAgICBsb2NhdGlvbiAvIHsKICAgICAgICB0cnlfZmlsZXMgJHVyaSAkdXJpLyAvaW5kZXguaHRtbDsKICAgIH0KfQo= | base64 -d > nginx.conf && echo c2VydmljZXM6CiAgdHJlaW5hbWVudG9zOgogICAgYnVpbGQ6IC4KICAgIGNvbnRhaW5lcl9uYW1lOiB0cmVpbmFtZW50b3MKICAgIHJlc3RhcnQ6IHVubGVzcy1zdG9wcGVkCiAgICBwb3J0czoKICAgICAgLSAiODA4MTo4MCIK | base64 -d > docker-compose.yml && docker compose up -d --build"

echo.
echo Treinamentos atualizado e no ar em http://%IP%:8081
echo.
pause
goto MENU

:SITE_TREINO
start http://%IP%:8081
goto MENU

:SWAP
cls
echo Criando swap de 4GB para evitar falta de memoria...
ssh -i "%KEY%" %USER%@%IP% "sudo swapoff /swapfile 2>/dev/null; sudo rm -f /swapfile && sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && (grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab) && free -h"
pause
goto MENU

:CATCOMPOSE
cls
echo docker-compose.yml atual do WhatsAtendende:
ssh -i "%KEY%" %USER%@%IP% "cat %PROJETO%/docker-compose.yml"
pause
goto MENU

:CATENV
cls
echo Verificando .env, commit e bundle do Treinamentos...
ssh -i "%KEY%" %USER%@%IP% "echo ===ENV=== ; cat ~/treinamentos/.env 2>&1 ; echo ===GITLOG=== ; cd ~/treinamentos && git log -1 --oneline ; echo ===BUNDLE=== ; docker exec treinamentos grep -rl supabase.co /usr/share/nginx/html/assets/ ; echo ===FIM==="
pause
goto MENU

:REMOVE_CHAMADOS
cls
echo.
echo Isso para os containers do Chamados e apaga a pasta ~/chamados
echo na VPS (os dados do banco em volumes Docker NAO sao apagados -
echo se quiser apaga-los de vez depois, rode "docker volume prune"
echo manualmente).
echo.
set /p resp=Tem certeza que deseja remover o Chamados da VPS? (S/N):
if /I "%resp%"=="S" (
    ssh -i "%KEY%" %USER%@%IP% "cd ~/chamados && docker compose down; cd ~ && rm -rf ~/chamados"
)
pause
goto MENU
