const glados = async () => {
  const notice = []
  let failed = false

  if (!process.env.GLADOS) {
    return { notice: ['Checkin Error', 'GLADOS secret is missing'], failed: true }
  }

  // GLaDOS 会校验签到请求 UA 是否与登录时浏览器一致。
  // 多账号时，GLADOS_UA 可按行与 GLADOS Cookie 一一对应；
  // 若只提供一行 UA，则所有账号共用该 UA。
  const agents = String(process.env.GLADOS_UA || '').split('\n').filter(Boolean)
  const cookies = String(process.env.GLADOS).split('\n').filter(Boolean)

  for (const [index, cookie] of cookies.entries()) {
    try {
      const domain = process.env.DOMAIN || 'glados.cloud'
      const common = {
        cookie,
        referer: `https://${domain}/console/checkin`,
        'user-agent':
          agents[index] ||
          agents[0] ||
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      }

      const action = await fetch(`https://${domain}/api/user/checkin`, {
        method: 'POST',
        headers: { ...common, 'content-type': 'application/json' },
        body: JSON.stringify({ token: domain }),
      }).then((r) => r.json())

      const message = String(action?.message || '')
      const alreadyCheckedIn =
        /today'?s observation logged|return tomorrow|already checked|已签到|已经签到/i.test(message)

      if (action?.code && !alreadyCheckedIn) {
        const details = [
          `code=${action.code}`,
          action?.reason ? `reason=${action.reason}` : null,
        ].filter(Boolean).join(', ')
        throw new Error(`${message || 'checkin failed'} (${details})`)
      }

      const status = await fetch(`https://${domain}/api/user/status`, {
        method: 'GET',
        headers: common,
      }).then((r) => r.json())

      if (status?.code) {
        const details = [
          `code=${status.code}`,
          status?.reason ? `reason=${status.reason}` : null,
        ].filter(Boolean).join(', ')
        throw new Error(`${status?.message || 'status failed'} (${details})`)
      }

      notice.push(
        'Checkin OK',
        message || 'Already checked in',
        `Left Days ${Number(status?.data?.leftDays)}`
      )
    } catch (error) {
      failed = true
      notice.push(
        'Checkin Error',
        `${error}`,
        `<${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}>`
      )
    }
  }

  return { notice, failed }
}

const notify = async (notice) => {
  if (!process.env.NOTIFY || !notice) return

  for (const option of String(process.env.NOTIFY).split('\n')) {
    if (!option) continue

    if (option.startsWith('console:')) {
      continue
    } else if (option.startsWith('wxpusher:')) {
      await fetch('https://wxpusher.zjiecode.com/api/send/message', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          appToken: option.split(':')[1],
          summary: notice[0],
          content: notice.join('<br>'),
          contentType: 3,
          uids: option.split(':').slice(2),
        }),
      })
    } else if (option.startsWith('pushplus:')) {
      await fetch('https://www.pushplus.plus/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: option.split(':')[1],
          title: notice[0],
          content: notice.join('<br>'),
          template: 'markdown',
        }),
      })
    } else if (option.startsWith('bark:')) {
      await fetch(`https://api.day.app/${option.split(':')[1]}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: notice[0],
          body: notice.slice(1).join('\n'),
        }),
      })
    } else if (option.startsWith('qyweixin:')) {
      const qyweixinToken = option.split(':')[1]
      await fetch(
        'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=' + qyweixinToken,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            msgtype: 'markdown',
            markdown: { content: notice.join('<br>') },
          }),
        }
      )
    } else {
      await fetch('https://www.pushplus.plus/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: option,
          title: notice[0],
          content: notice.join('<br>'),
          template: 'markdown',
        }),
      })
    }
  }
}

const main = async () => {
  const { notice, failed } = await glados()
  await notify(notice)

  for (const line of notice) console.log(line)

  if (failed) process.exitCode = 1
}

main()
