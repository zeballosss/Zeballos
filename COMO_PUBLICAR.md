# Colocar o site na Vercel

Seu repositório: https://github.com/zeballosss/Zeballos

**Envie os arquivos extraídos. Colocar só o ZIP no GitHub não publica o site.**

## Jeito recomendado: GitHub Desktop

1. Instale o [GitHub Desktop](https://desktop.github.com/) e entre na sua conta.
2. Abra **File → Clone repository → URL**. Cole `https://github.com/zeballosss/Zeballos.git`, escolha uma pasta no computador e clique em **Clone**. O repositório pode aparecer vazio: tudo bem.
3. Extraia o ZIP do site. Copie o **conteúdo** da pasta extraída para a pasta `Zeballos` que o Desktop criou. O `index.html` precisa ficar direto nessa pasta, junto de `styles.css`, `app.js`, `vercel.json` e `assets`.
4. Volte ao Desktop. Em **Summary**, escreva `Adicionar site da turma` e clique em **Commit to main** — ou no nome da sua branch principal.
5. Clique em **Push origin**. No primeiro envio de uma branch, o botão pode ser **Publish branch**.
6. Abra seu projeto na Vercel e veja **Deployments**. Se a integração com o GitHub estiver ativa, o envio para a branch de produção inicia uma publicação. Espere aparecer **Ready** e abra o endereço do site.

Nas próximas alterações: edite os arquivos nessa mesma pasta, faça **Commit** e depois **Push origin**.

## Só se a Vercel der erro

Em **Settings → Build and Deployment**, confira:

| Campo | Valor |
| --- | --- |
| Framework Preset | `Other` |
| Root Directory | Raiz do repositório: `.` ou o padrão vazio |
| Build Command | Ative Override e deixe vazio |
| Output Directory | `.` |

Salve e faça **Redeploy**. Este site usa HTML, CSS e JavaScript: não precisa de npm, banco de dados nem variáveis de ambiente. O `vercel.json` já acompanha o projeto.

Se não aparecer nenhum deployment, confira em **Settings → Git** se o projeto está conectado a `zeballosss/Zeballos` e se a branch de produção é a mesma que recebeu os arquivos.

## Sem instalar o Desktop

No repositório vazio, clique em **uploading an existing file**. Depois, use **Add file → Upload files**. Arraste os arquivos extraídos e confirme o commit. O GitHub aceita até **100 arquivos por envio** pelo navegador; divida a pasta `assets` em lotes, mantendo os caminhos das subpastas. Como há muitas fotos, o Desktop facilita bastante.

## Mudar depois

- Textos da página: `index.html`.
- Nomes e lista de fotos: `assets/data.js`.
- Jogos do intervalo: `arcade.js` e `arcade.css`.
- Visual e cores: `styles.css`.
- Botões e brincadeiras: `app.js`.
- Ao trocar uma imagem, mantenha seu caminho ou atualize a entrada correspondente em `assets/data.js`.

Combine com a turma quais fotos podem ficar públicas antes de compartilhar o endereço.

## Referências

Documentação oficial consultada em 25/11/2026:

- [Clonar com GitHub Desktop](https://docs.github.com/en/desktop/adding-and-cloning-repositories/cloning-and-forking-repositories-from-github-desktop?platform=windows).
- [Enviar arquivos pelo GitHub](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository).
- [Configurar a publicação estática na Vercel](https://vercel.com/docs/builds/configure-a-build).
- [Publicações automáticas pelo Git](https://vercel.com/docs/git).

A conexão da sua conta da Vercel e suas configurações atuais não foram verificadas por este guia.
