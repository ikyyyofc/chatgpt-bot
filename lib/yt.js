const axios = require('axios');
const yts = require('yt-search')

class Youtube {
    constructor() {
        this.baseUrl = 'https://ab.cococococ.com/ajax/download.php'
        this.headers = {
            headers: {
                'Accept': '*/*',
                'Accept-Encoding': 'gzip, deflate, br, zstd',
                'Origin': 'https://y2down.cc',
                'Referer': 'https://y2down.cc/',
                'User-Agent': 'Zeyn'
            }
        }
    }

    getInfo = async (id) => {
        try {
            const search = await yts({ videoId: id})
            return search
        } catch (e) {
            return e.message
        }
    }

    getId = (url, quality = 360) => {
        return new Promise(async(resolve, reject) => {
            try {
                const requestData = (await axios.get(this.baseUrl + '?format=' + quality + '&url=' + encodeURIComponent(url), this.headers)).data
                const res = Object.assign(requestData, { format: quality })
                resolve({
                    creator: "Zeyn - IkyyOFC",
                    status: true,
                    data: res
                })
            } catch (e) {
                resolve({
                    creator: "Zeyn - IkyyOFC",
                    status: false,
                    msg: e.message
                })
            }
        })
    }

    getResult = async (url, quality) => {
        try {
            let id
            if (url.includes('youtube.com')) {
                id = url.split('=')[1]
            } else if (url.includes('youtu.be')) {
                const a = url.split('/')[3]
                id = a.split('=')[0]
            }
            const getIdFromUrl = (await this.getId(url, quality)).data
            const getInfoUrl = await this.getInfo(id)
            while (true) {
                const requestToGateUrl = (await axios.get('https://p.oceansaver.in/ajax/progress.php?id=' + getIdFromUrl.id, this.headers)).data
                if (requestToGateUrl.success == 1) {
                    const modifiedResult = {
                        media: { format: Number(getIdFromUrl.format) ? 'mp4' : getIdFromUrl.format, url: requestToGateUrl.download_url }
                    }
                    const res = Object.assign(getInfoUrl, modifiedResult)
                    return {
                        creator: "Zeyn - IkyyOFC",
                        status: true,
                        data: res
                    }
                } else if (requestToGateUrl.success == 0) {
                    await new Promise(resolve => setTimeout(resolve, 1000))
                } else {
                    return {
                        creator: "Zeyn - IkyyOFC",
                        status: false,
                        msg: 'Wrong download from this url!'
                    }
                }
            }
        } catch (e) {
            return {
                creator: "Zeyn - IkyyOFC",
                status: false,
                msg: e.message
            }
        }
    }
}

module.exports = Youtube