# CI/CD — Deploy automático na EC2 via GitHub Actions

Pipeline em `.github/workflows/ci.yml`:

```
push/PR ──► lint (biome) ──► migrate ──► testes (Postgres 17 service)
                                    │
              (push em main apenas) ▼
                              deploy-ec2 ──► SSH na instância ──► git reset + rebuild total
```

O deploy **só roda em push para `main`** e **só depois que lint + testes passam**. O job:

1. Descobre o **IP público do próprio runner** (`https://checkip.amazonaws.com`);
2. Autoriza esse IP (`/32`, porta 22) no **security group** da EC2 via AWS CLI;
3. Conecta por SSH e executa a sequência de rebuild total (runbook de memória):
   `git fetch/checkout/reset` → `docker-compose down -v` → `docker system prune -a --volumes -f` → `docker-compose up -d --build --force-recreate` (sem BuildKit, igual ao manual);
4. **Revoga** a regra de SSH no fim (`if: always()` — revoga mesmo se o deploy falhar).

> **Não é preciso autorizar IPs do GitHub manualmente.** Os runners do GitHub
> usam IPs que mudam a cada execução. O range completo está em
> `https://api.github.com/meta` (chave `actions`) — mas são centenas de blocos
> que mudam semanalmente; o padrão adotado aqui (autoriza o IP do runner →
> usa → revoga) é mais seguro: a porta 22 fica fechada para o mundo o resto
> do tempo.

---

## Segredos a criar no GitHub

`Settings → Secrets and variables → Actions → New repository secret`

| Secret | Valor | De onde vem |
|---|---|---|
| `EC2_SSH_KEY` | Conteúdo **completo** do arquivo `NINBUS_API.pem` (inclusive as linhas `-----BEGIN/END RSA PRIVATE KEY-----`) | A mesma chave usada no `ssh -i "NINBUS_API.pem"` |
| `EC2_HOST` | `ec2-54-242-25-62.compute-1.amazonaws.com` (ou o IP `54.242.25.62`) | DNS público da instância no console EC2 |
| `EC2_USER` | `ec2-user` | Usuário padrão Amazon Linux |
| `AWS_ACCESS_KEY_ID` | O `Access key ID` do `accessKey.csv` | IAM → Users → seu usuário → Security credentials |
| `AWS_SECRET_ACCESS_KEY` | O `Secret access key` do `accessKey.csv` | Idem (só é mostrado na criação — está no CSV) |
| `AWS_REGION` | `us-east-1` | Região da instância (compute-1 = us-east-1) |
| `AWS_SECURITY_GROUP_ID` | `sg-xxxxxxxx` | Security group anexado à instância (ver abaixo) |

### Como descobrir o `AWS_SECURITY_GROUP_ID`

**Console:** EC2 → Instances → selecione `ec2-54-242-25-62...` → aba
**Security** → o primeiro item "Security groups" mostra o nome e o **ID** (`sg-...`). Clique nele e copie o ID da barra de detalhes.

**CLI (qualquer máquina com AWS configurado):**

```bash
aws ec2 describe-instances \
  --region us-east-1 \
  --filters 'Name=ip-address,Values=54.242.25.62' \
  --query 'Reservations[].Instances[].SecurityGroups[].GroupId' \
  --output text
```

### Permissão mínima da chave de acesso (IAM)

O usuário dono do `accessKey.csv` **não precisa de acesso total à EC2**.
Crie uma policy inline e anexe só o necessário:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowTemporarySshIngressForCI",
      "Effect": "Allow",
      "Action": [
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:RevokeSecurityGroupIngress"
      ],
      "Resource": "arn:aws:ec2:us-east-1:<SUA_CONTA_AWS_ID>:security-group/sg-xxxxxxxx"
    }
  ]
}
```

(Para descobrir o ID da conta: `aws sts get-caller-identity`.)

---

## Sobre os outros arquivos de credencial

- **`global-bundle.pem`** → **não vai para o GitHub.** É o CA bundle da AWS RDS,
  usado só na EC2 quando a aplicação conecta no RDS com TLS verificado. Ele já
  deve existir no servidor (o `docker-compose.yml` da instância referencia).
- **`ninbus.pem` / `private_key.pem`** → chaves locais de outros fluxos
  (assinatura OTA / acesso próprio). Nada a ver com o deploy via Actions.

## Pré-requisitos na EC2 (uma única vez)

1. Repo clonado em `~/Ninbus-api` e **checkout em `main`** (o deploy faz
   `git reset --hard origin/main` — se o servidor estiver em outra branch,
   o reset já resolve, mas alterações locais não-commitadas são descartadas);
2. Git da instância autenticado no GitHub (deploy key somente-leitura ou
   HTTPS com token) para o `git fetch` funcionar;
3. `docker` + `docker-compose` instalados (já estão, é o fluxo manual atual);
4. `.env` de produção presente na home do projeto (o compose usa).

## Notas operacionais

- `concurrency: deploy-production` impede dois deploys simultâneos, e runs de
  CI em `main` nunca são cancelados por um push novo (só enfileiram) para não
  abortar um rebuild no meio;
- Se um deploy falhar no meio, a regra de SSH ainda é revogada (`if: always()`);
- O `docker system prune -a --volumes -f` apaga **todas** as imagens e volumes
  não usados — é o runbook escolhido para liberar memória/disco antes do build
  (derruba e reconstroi tudo, como pedido);
- Para rodar só lint+testes manualmente: **Actions → CI → Run workflow**
  (deploy continua restrito a push em `main`).
