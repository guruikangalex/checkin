import { createHash } from 'node:crypto'

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

      // 2026-11-07: 使用站点公布的 challenge/proof 请求格式，避免旧版裸请求静默降级。
      const challengeResponse = await fetch('https://' + domain + '/api/user/checkin/challenge', {
        method: 'GET',
        headers: { ...common, accept: '*/*', origin: 'https://' + domain },
      })
      if (!challengeResponse.ok) throw new Error('Challenge HTTP ' + challengeResponse.status)
      const challenge = await challengeResponse.json()
      if (Number(challenge?.code) !== 0 || !challenge?.nonce) {
        throw new Error('Challenge rejected: ' + String(challenge?.message || 'nonce missing'))
      }
      // 按前端协议在获取 challenge 后留出最小处理间隔；不处理 CAPTCHA。
      await new Promise((resolve) => setTimeout(resolve, 2800))
      const proof = createHash('sha256')
        .update(String(challenge.nonce) + '.glados-observe-v1', 'utf8')
        .digest('hex')
      const actionResponse = await fetch('https://' + domain + '/api/user/checkin', {
        method: 'POST',
        headers: { ...common, accept: '*/*', origin: 'https://' + domain, 'content-type': 'application/json' },
        body: JSON.stringify({ token: domain, nonce: challenge.nonce, proof }),
      })
      if (!actionResponse.ok) throw new Error('Checkin HTTP ' + actionResponse.status)
      const action = await actionResponse.json()
      console.log('Account ' + (index + 1) + ': challenge/proof submitted')

      const message = String(action?.message || '')
      const alreadyCheckedIn =
        Number(action?.code) === 1 ||
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

      // 仅依据可用的服务端积分、套餐、连续天数、IQI 信息判断是否降级；缺失字段不臆测。
      let earned = null
      const rawEarned = action?.points ?? action?.data?.points
      if (rawEarned !== undefined && rawEarned !== null && Number.isFinite(Number(rawEarned))) {
        earned = Number(rawEarned)
      } else {
        const match = message.match(/got\s+([\d.]+)\s+points?/i)
        if (match) earned = Number(match[1])
      }
      if (!alreadyCheckedIn && earned !== null) {
        console.log('Account ' + (index + 1) + ': earned ' + earned + ' points')
        let minimum = 1
        let evidence = 0
        const vip = Number(status?.data?.vip ?? status?.vip)
        if (Number.isFinite(vip)) {
          minimum += vip === 31 ? 1 : vip === 41 ? 1.5 : vip === 51 ? 2 : 0
          evidence++
        }
        try {
          const pointsResponse = await fetch('https://' + domain + '/api/user/points', { headers: common })
          if (pointsResponse.ok) {
            const points = await pointsResponse.json()
            const streak = Number(points?.streak ?? points?.data?.streak)
            if (Number(points?.code) === 0 && Number.isFinite(streak)) {
              minimum += streak > 14 ? 2 : streak > 7 ? 1 : 0
              evidence++
            }
          }
        } catch (err) { console.warn('Points verification unavailable: ' + err.message) }
        try {
          const iqiResponse = await fetch('https://' + domain + '/api/user/iqi', { headers: common })
          if (iqiResponse.ok) {
            const iqi = await iqiResponse.json()
            const rawScore = iqi?.data?.quality?.score ?? iqi?.quality?.score ?? iqi?.data?.score
            const score = Number(rawScore)
            if (Number(iqi?.code) === 0 && rawScore != null && Number.isFinite(score) && score > 0) {
              minimum += score < 80 ? 8 : score < 85 ? 5 : score < 90 ? 3 : score <= 95 ? 2 : 1
              evidence++
            }
          }
        } catch (err) { console.warn('IQI verification unavailable: ' + err.message) }
        if (evidence > 0 && earned < minimum) {
          throw new Error('Points downgraded: received ' + earned + ', expected at least ' + minimum +
            ' from available plan/streak/IQI data; check challenge protocol')
        }
        if (earned <= 1 && evidence === 0) {
          console.warn('Low points without enough data to verify bonuses; inspect points in GLaDOS console')
        }
      }

      notice.push(
        'Checkin OK',
        message || 'Already checked in',
        earned === null || alreadyCheckedIn ? 'Points: already checked / not reported' : 'Points: +' + earned,
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
