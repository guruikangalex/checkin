const glados = async () => {
  const notice = []
  let failed = false

  if (!process.env.GLADOS) {
    return { notice: ['Checkin Error', 'GLADOS secret is missing'], failed: true }
  }

  for (const cookie of String(process.env.GLADOS).split('\n')) {
    if (!cookie) continue

    try {
      const domain = process.env.DOMAIN || 'glados.cloud'
      const common = {
        cookie,
        referer: `https://${domain}/console/checkin`,
        'user-agent': 'Mozilla/5.0',
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
        throw new Error(message || `checkin failed with code ${action?.code}`)
      }

      const status = await fetch(`https://${domain}/api/user/status`, {
        method: 'GET',
        headers: common,
      }).then((r) => r.json())

      if (status?.code) {
        throw new Error(status?.message || `status failed with code ${status?.code}`)
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
      for (const line of notice) console.log(line)
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
