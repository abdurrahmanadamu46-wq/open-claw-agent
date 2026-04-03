#!/usr/bin/env python3
"""
榫欒櫨鐭ヨ瘑鍖呮壒閲忓～鍏呰剼鏈?鈥?SP2 Knowledge Pack Generator
==========================================================

璇诲彇姣忓彧铏剧殑 role-card.json + prompt-kit锛岃皟鐢?OpenAI 鍏煎鎺ュ彛鐢熸垚锛?  1. industry-rules.json          姣忚櫨闇€瑕佺煡閬撶殑琛屼笟瑙勫垯 / 鏈€浣冲疄璺?  2. hooks-library.json           姣忚櫨鍙敤鐨勮Е鍙戦挬瀛?/ 琛屽姩妯℃澘
  3. scoring-features.json        姣忚櫨璇勪及璐ㄩ噺鐨勭壒寰佺淮搴?  4. expanded-golden-cases.json   鎵╁睍 datasets/golden-cases.json

浣跨敤鏂规硶锛?  1. 璁剧疆鐜鍙橀噺锛堜笉瑕佹妸瀵嗛挜鍐欒繘浠撳簱锛?     set OPENAI_API_KEY=sk-xxx
     set OPENAI_BASE_URL=https://www.ananapi.com/
     set OPENAI_MODEL=gpt-5.4

     鍙€夛細澶?key 杞崲
     set OPENAI_API_KEYS=sk-a,sk-b,sk-c

  2. 杩愯
     python scripts/generate-knowledge-packs.py

  3. 鍙€夊弬鏁?     --lobster radar
     --lobster all
     --dry-run
     --industries "椁愰ギ鏈嶅姟_涓棣?鍖荤枟鍋ュ悍_鍙ｈ厰闂ㄨ瘖"
     --pack-types industry_rules,hooks,scoring,golden_cases

璇存槑锛?  - 榛樿杈撳嚭鍒?dragon-senate-saas-v2/data/knowledge-packs/<lobster>/<industry>/
  - 榛樿妯″瀷閰嶇疆瀵归綈褰撳墠椤圭洰涓荤嚎锛?      base_url = https://www.ananapi.com/
      model    = gpt-5.4
  - 鑴氭湰鍙細鎻愰啋鈥滄€昏皟鐢ㄦ鏁扳€濓紝鏃犳硶绮剧‘鐭ラ亾绗笁鏂瑰钩鍙扮殑鐪熷疄浣欓鏄惁鑰楀敖
"""

from __future__ import annotations

import argparse
import json
import os
import ssl
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
LOBSTERS_DIR = REPO_ROOT / "packages" / "lobsters"
OUTPUT_DIR = REPO_ROOT / "dragon-senate-saas-v2" / "data" / "knowledge-packs"

ALL_LOBSTER_IDS = [
    "radar",
    "strategist",
    "inkwriter",
    "visualizer",
    "dispatcher",
    "echoer",
    "catcher",
    "abacus",
    "followup",
]

DEFAULT_INDUSTRIES = [
    "椁愰ギ鏈嶅姟_涓棣?,
    "椁愰ギ鏈嶅姟_鐏攨搴?,
    "椁愰ギ鏈嶅姟_鐑х儰搴?,
    "椁愰ギ鏈嶅姟_濂惰尪搴?,
    "椁愰ギ鏈嶅姟_鍜栧暋搴?,
    "椁愰ギ鏈嶅姟_鐑樼剻搴?,
    "椁愰ギ鏈嶅姟_蹇搴?,
    "閰掑簵姘戝_鍟嗗姟閰掑簵",
    "閰掑簵姘戝_搴﹀亣閰掑簵",
    "閰掑簵姘戝_绮惧搧姘戝",
    "閰掑簵姘戝_鍩庡競姘戝",
    "閰掑簵姘戝_瀹㈡爤",
    "閰掑簵姘戝_鍏瘬閰掑簵",
    "缇庝笟鍋ュ悍_缇庡闄?,
    "缇庝笟鍋ュ悍_缇庣敳搴?,
    "缇庝笟鍋ュ悍_缇庡彂搴?,
    "缇庝笟鍋ュ悍_杞诲尰缇庢満鏋?,
    "缇庝笟鍋ュ悍_鐨偆绠＄悊",
    "缇庝笟鍋ュ悍_鍏荤敓棣?,
    "缇庝笟鍋ュ悍_鐞嗙枟棣?,
    "鏁欒偛鍩硅_鑱屼笟鏁欒偛",
    "鏁欒偛鍩硅_璇█鍩硅",
    "鏁欒偛鍩硅_鑰冪爺鍩硅",
    "鏁欒偛鍩硅_鑹烘湳鍩硅",
    "鏁欒偛鍩硅_灏戝効绱犺川鏁欒偛",
    "鏁欒偛鍩硅_鎴愪汉鎶€鑳藉煿璁?,
    "姹借溅鏈嶅姟_浜屾墜杞﹂棬搴?,
    "姹借溅鏈嶅姟_鏂拌溅缁忛攢",
    "姹借溅鏈嶅姟_姹借溅缇庡",
    "姹借溅鏈嶅姟_姹借溅缁翠慨",
    "姹借溅鏈嶅姟_姹借溅鏀硅",
    "姹借溅鏈嶅姟_姹借溅绉熻祦",
    "寤虹瓚琛屼笟_闂ㄦゼ",
    "瀹跺眳瑁呬慨_瑁呬慨鍏徃",
    "瀹跺眳瑁呬慨_鍏ㄥ眿瀹氬埗",
    "瀹跺眳瑁呬慨_瀹跺眳寤烘潗",
    "瀹跺眳瑁呬慨_瀹剁數闂ㄥ簵",
    "瀹跺眳瑁呬慨_鏅鸿兘瀹跺眳",
    "瀹跺眳瑁呬慨_杞璁捐",
    "鏈湴闆跺敭_鐢熼矞闂ㄥ簵",
    "鏈湴闆跺敭_绀惧尯瓒呭競",
    "鏈湴闆跺敭_姣嶅┐闂ㄥ簵",
    "鏈湴闆跺敭_瀹犵墿闂ㄥ簵",
    "鏈湴闆跺敭_鐑熼厭搴?,
    "鏈湴闆跺敭_鑽簵",
    "鐢熸椿鏈嶅姟_瀹舵斂鏈嶅姟",
    "鐢熸椿鏈嶅姟_鎼鏈嶅姟",
    "鐢熸椿鏈嶅姟_娲楄。娲楁姢",
    "鐢熸椿鏈嶅姟_寮€閿佹湇鍔?,
    "鐢熸椿鏈嶅姟_绠￠亾缁翠慨",
    "鐢熸椿鏈嶅姟_瀹剁數娓呮礂",
    "鍖荤枟鍋ュ悍_鍙ｈ厰闂ㄨ瘖",
    "鍖荤枟鍋ュ悍_鐪肩闂ㄨ瘖",
    "鍖荤枟鍋ュ悍_浣撴涓績",
    "鍖荤枟鍋ュ悍_搴峰涓績",
    "鍖荤枟鍋ュ悍_涓尰璇婃墍",
    "鍖荤枟鍋ュ悍_蹇冪悊鍜ㄨ",
]

PACK_TYPE_TO_FILENAME = {
    "industry_rules": "industry-rules.json",
    "hooks": "hooks-library.json",
    "scoring": "scoring-features.json",
    "golden_cases": "expanded-golden-cases.json",
}

LOBSTER_KB_INSTRUCTIONS: dict[str, dict[str, str]] = {
    "radar": {
        "industry_rules": "浣滀负瑙﹂』铏?Radar)锛屼綘璐熻矗淇″彿鎵弿鍜屽櫔闊宠繃婊ゃ€傝鐢熸垚璇ヨ涓氫腑锛?锛夊钩鍙拌鍒欏彉鏇寸殑甯歌妯″紡 2锛夌珵鍝佺洃鎺х殑鍏抽敭鎸囨爣 3锛変俊鍙峰彲淇″害璇勪及瑙勫垯 4锛夊櫔闊宠繃婊よ鍒?,
        "hooks": "璇风敓鎴怰adar铏惧湪璇ヨ涓氬彲鐢ㄧ殑鐩戞帶閽╁瓙锛?锛夊钩鍙板叕鍛婄洃鎺цЕ鍙戝櫒 2锛夌珵鍝佽涓哄彉鍖栨娴嬬偣 3锛夎秼鍔夸俊鍙疯仛鍚堣鍒?4锛夐璀﹂槇鍊艰缃?,
        "scoring": "璇风敓鎴怰adar铏捐瘎浼颁俊鍙疯川閲忕殑璇勫垎鐗瑰緛锛?锛夋潵婧愬彲淇″害(0-1) 2锛変俊鍙锋柊椴滃害 3锛夊奖鍝嶈寖鍥?4锛夊彲鎿嶄綔鎬?5锛夊櫔闊虫鐜?,
    },
    "strategist": {
        "industry_rules": "浣滀负鑴戣櫕铏?Strategist)锛屼綘璐熻矗鐩爣鎷嗚В鍜岀瓥鐣ヨ矾鐢便€傝鐢熸垚璇ヨ涓氫腑锛?锛夊吀鍨嬭幏瀹㈢瓥鐣ユā寮?2锛塕OI 浼樺厛绾ф帓搴忚鍒?3锛夐闄╄瘎浼版爣鍑?4锛夎祫婧愬垎閰嶅師鍒?,
        "hooks": "璇风敓鎴怱trategist铏惧湪璇ヨ涓氬彲鐢ㄧ殑绛栫暐閽╁瓙锛?锛夌瓥鐣ヨЕ鍙戞潯浠?2锛堿/B娴嬭瘯妗嗘灦 3锛夐绠楀垎閰嶆ā鏉?4锛夋鎹熻Е鍙戠偣",
        "scoring": "璇风敓鎴怱trategist铏捐瘎浼扮瓥鐣ヨ川閲忕殑璇勫垎鐗瑰緛锛?锛夌洰鏍囪揪鎴愭鐜?2锛夎祫婧愭晥鐜?3锛夐闄╂毚闇插害 4锛夊彲鎵ц鎬?5锛夋椂闂寸獥鍙ｉ€傞厤搴?,
    },
    "inkwriter": {
        "industry_rules": "浣滀负鍚愬ⅷ铏?InkWriter)锛屼綘璐熻矗鎴愪氦瀵煎悜鏂囨銆傝鐢熸垚璇ヨ涓氫腑锛?锛夐珮杞寲鏂囨缁撴瀯妯℃澘 2锛夎涓氫笓涓氭湳璇簱 3锛夊悎瑙勭孩绾胯瘝姹?4锛夋儏鎰熼挬瀛愭ā寮?,
        "hooks": "璇风敓鎴怚nkWriter铏惧湪璇ヨ涓氬彲鐢ㄧ殑鏂囨閽╁瓙锛?锛夋爣棰樻ā鏉垮簱 2锛夌棝鐐?瑙ｅ喅鏂规瀵圭収琛?3锛夎鍔ㄥ彿鍙?CTA)妯℃澘 4锛変俊浠昏儗涔﹀厓绱?,
        "scoring": "璇风敓鎴怚nkWriter铏捐瘎浼版枃妗堣川閲忕殑璇勫垎鐗瑰緛锛?锛夐挬瀛愬己搴?2锛変笓涓氬害 3锛夋儏鎰熷叡楦?4锛夊悎瑙勫畨鍏ㄦ€?5锛塁TA娓呮櫚搴?,
    },
    "visualizer": {
        "industry_rules": "浣滀负骞诲奖铏?Visualizer)锛屼綘璐熻矗鍒嗛暅鍜岃瑙夎璁°€傝鐢熸垚璇ヨ涓氫腑锛?锛夐珮瀹屾挱鐜囪棰戠粨鏋?2锛夐灞忓惛寮曞姏瑙勫垯 3锛夎瑙夐鏍兼爣鍑?4锛夎瘉鎹劅鐢婚潰瑙勮寖",
        "hooks": "璇风敓鎴怴isualizer铏惧湪璇ヨ涓氬彲鐢ㄧ殑瑙嗚閽╁瓙锛?锛夊紑鍦?绉掓ā鏉?2锛夊垎闀滆妭濂忔ā鏉?3锛夊瓧骞?鏍囨敞鏍峰紡 4锛夎浆鍦烘晥鏋滄帹鑽?,
        "scoring": "璇风敓鎴怴isualizer铏捐瘎浼拌瑙夎川閲忕殑璇勫垎鐗瑰緛锛?锛夐灞忓仠鐣欑巼棰勬祴 2锛変俊鎭瘑搴?3锛夊搧鐗屼竴鑷存€?4锛夎瘉鎹劅寮哄害 5锛夊畬鎾巼棰勬祴",
    },
    "dispatcher": {
        "industry_rules": "浣滀负鐐瑰叺铏?Dispatcher)锛屼綘璐熻矗鎵ц璁″垝鎷嗗寘銆傝鐢熸垚璇ヨ涓氫腑锛?锛夊彂甯冭妭濂忚鍒?2锛夋笭閬撻€夋嫨鐭╅樀 3锛夌伆搴﹀彂甯冪瓥鐣?4锛夋鎹熸潯浠?,
        "hooks": "璇风敓鎴怐ispatcher铏惧湪璇ヨ涓氬彲鐢ㄧ殑璋冨害閽╁瓙锛?锛夋渶浣冲彂甯冩椂闂寸獥鍙?2锛夋笭閬撲紭鍏堢骇瑙勫垯 3锛夐绠楀垎閰嶈Е鍙戝櫒 4锛夌揣鎬ユ鎹熻Е鍙戝櫒",
        "scoring": "璇风敓鎴怐ispatcher铏捐瘎浼版墽琛岃鍒掕川閲忕殑璇勫垎鐗瑰緛锛?锛夎鐩栫巼 2锛夎妭濂忓悎鐞嗘€?3锛夎祫婧愬埄鐢ㄧ巼 4锛夐闄╃紦閲婂害 5锛夊搷搴旈€熷害",
    },
    "echoer": {
        "industry_rules": "浣滀负鍥炲０铏?Echoer)锛屼綘璐熻矗浜掑姩鍥炲鍜岃瘎璁虹鐞嗐€傝鐢熸垚璇ヨ涓氫腑锛?锛夌湡浜烘劅鍥炲妯℃澘 2锛夎礋闈㈣瘎璁哄鐞嗚鍒?3锛変簰鍔ㄨ浆鍖栬瘽鏈?4锛夋儏缁壙鎺ョ瓥鐣?,
        "hooks": "璇风敓鎴怑choer铏惧湪璇ヨ涓氬彲鐢ㄧ殑浜掑姩閽╁瓙锛?锛夋闈㈣瘎璁鸿窡杩涙ā鏉?2锛夎川鐤戝洖搴旀ā鏉?3锛夊紩瀵肩鑱婅瘽鏈?4锛夌ぞ缇や簰鍔ㄨЕ鍙戝櫒",
        "scoring": "璇风敓鎴怑choer铏捐瘎浼颁簰鍔ㄨ川閲忕殑璇勫垎鐗瑰緛锛?锛夌湡浜烘劅璇勫垎 2锛夋儏缁尮閰嶅害 3锛夎浆鍖栧紩瀵肩巼 4锛夊洖澶嶅強鏃舵€?5锛夊搧鐗岃皟鎬т竴鑷存€?,
    },
    "catcher": {
        "industry_rules": "浣滀负閾佺綉铏?Catcher)锛屼綘璐熻矗绾跨储璇嗗埆鍜岃繃婊ゃ€傝鐢熸垚璇ヨ涓氫腑锛?锛夐珮鎰忓悜淇″彿璇嗗埆瑙勫垯 2锛変綆璐ㄩ噺绾跨储杩囨护瑙勫垯 3锛夐绠楀垽鏂爣鍑?4锛夌揣杩害璇勪及缁村害",
        "hooks": "璇风敓鎴怌atcher铏惧湪璇ヨ涓氬彲鐢ㄧ殑绾跨储鎹曡幏閽╁瓙锛?锛夋剰鍚戝叧閿瘝搴?2锛夎涓轰俊鍙疯Е鍙戝櫒 3锛夌珵鍝佹瘮杈冧俊鍙?4锛夎喘涔版椂鏈轰俊鍙?,
        "scoring": "璇风敓鎴怌atcher铏捐瘎浼扮嚎绱㈣川閲忕殑璇勫垎鐗瑰緛锛?锛夋剰鍚戝己搴?0-100) 2锛夐绠楀尮閰嶅害 3锛夊喅绛栭樁娈?4锛夋椂鏁堟€?5锛夎浆鍖栨鐜?,
    },
    "abacus": {
        "industry_rules": "浣滀负閲戠畻铏?Abacus)锛屼綘璐熻矗璇勫垎鍜孯OI璁＄畻銆傝鐢熸垚璇ヨ涓氫腑锛?锛塕OI璁＄畻鍏紡 2锛夊綊鍥犳ā鍨嬭鍒?3锛夋垚鏈熀鍑嗙嚎 4锛夋晥鏋滃鏍囨爣鍑?,
        "hooks": "璇风敓鎴怉bacus铏惧湪璇ヨ涓氬彲鐢ㄧ殑璇勪及閽╁瓙锛?锛夊疄鏃禦OI璁＄畻瑙﹀彂鍣?2锛夋垚鏈秴鏍囬璀?3锛夋晥鏋滄嫄鐐规娴?4锛夊綊鍥犵獥鍙ｈ鍒?,
        "scoring": "璇风敓鎴怉bacus铏捐瘎浼版晥鏋滆川閲忕殑璇勫垎鐗瑰緛锛?锛塁PA(鍗曞鎴愭湰) 2锛塕OAS(骞垮憡鍥炴姤) 3锛塋TV棰勬祴 4锛夋笭閬撴晥鐜?5锛夎竟闄呮敹鐩?,
    },
    "followup": {
        "industry_rules": "浣滀负鍥炶铏?FollowUp)锛屼綘璐熻矗瀹㈡埛璺熻繘鍜屼簩娆℃縺娲汇€傝鐢熸垚璇ヨ涓氫腑锛?锛夎窡杩涜妭濂廠OP 2锛変簩娆℃縺娲昏瘽鏈?3锛夊鎴峰垎灞傝鍒?4锛夋祦澶遍璀︿俊鍙?,
        "hooks": "璇风敓鎴怓ollowUp铏惧湪璇ヨ涓氬彲鐢ㄧ殑璺熻繘閽╁瓙锛?锛夐娆¤窡杩涙椂鏈?2锛夊娆¤窡杩涜妭濂忔ā鏉?3锛夋縺娲讳紭鎯犺Е鍙戝櫒 4锛夋祦澶辨尳鍥炶Е鍙戝櫒",
        "scoring": "璇风敓鎴怓ollowUp铏捐瘎浼拌窡杩涜川閲忕殑璇勫垎鐗瑰緛锛?锛夎窡杩涘強鏃舵€?2锛夊鎴锋弧鎰忓害 3锛変簩娆¤浆鍖栫巼 4锛夋祦澶辨尳鍥炵巼 5锛塋TV鎻愬崌",
    },
}


# ---------------------------------------------------------------------------
# LLM Client
# ---------------------------------------------------------------------------

def _load_api_keys() -> list[str]:
    multi = os.getenv("OPENAI_API_KEYS", "").strip()
    if multi:
        return [item.strip() for item in multi.split(",") if item.strip()]
    single = os.getenv("OPENAI_API_KEY", "").strip()
    return [single] if single else []


def _call_llm(
    prompt: str,
    *,
    system: str,
    model: str,
    base_url: str,
    api_key: str,
) -> str:
    if not api_key:
        raise RuntimeError("No OpenAI-compatible API key available")

    url = f"{base_url.rstrip('/')}/chat/completions"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.7,
        "max_tokens": 4000,
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=180, context=ctx) as resp:
        body = json.loads(resp.read().decode("utf-8"))
        return body["choices"][0]["message"]["content"]


def _parse_json_from_llm(text: str) -> Any:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if len(lines) >= 2:
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        for idx, ch in enumerate(cleaned):
            if ch in {"{", "["}:
                try:
                    return json.loads(cleaned[idx:])
                except json.JSONDecodeError:
                    continue
        return {"_raw_text": cleaned}


# ---------------------------------------------------------------------------
# Data Loading
# ---------------------------------------------------------------------------

def load_role_card(lobster_id: str) -> dict[str, Any]:
    path = LOBSTERS_DIR / f"lobster-{lobster_id}" / "role-card.json"
    if not path.exists():
        raise FileNotFoundError(f"Role card not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def load_system_prompt(lobster_id: str) -> str:
    path = LOBSTERS_DIR / f"lobster-{lobster_id}" / "prompt-kit" / "system.prompt.md"
    return path.read_text(encoding="utf-8") if path.exists() else ""


def load_existing_golden_cases(lobster_id: str) -> dict[str, Any]:
    path = LOBSTERS_DIR / f"lobster-{lobster_id}" / "datasets" / "golden-cases.json"
    if not path.exists():
        return {"cases": []}
    return json.loads(path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Prompt Builders
# ---------------------------------------------------------------------------

def build_system_message(role_card: dict[str, Any], system_prompt: str) -> str:
    return (
        f"浣犳槸 OpenClaw Agent 榫欒櫨鍏冭€侀櫌涓殑 {role_card.get('zhName', role_card.get('roleId', 'lobster'))}"
        f" ({role_card.get('displayName', role_card.get('roleId', 'lobster'))})銆俓n"
        f"浣犵殑鑱岃矗锛歿role_card.get('mission', '')}\n"
        f"浣犵殑涓昏宸ヤ欢锛歿role_card.get('primaryArtifact', '')}\n"
        f"浣犵殑杈撳叆濂戠害锛歿json.dumps(role_card.get('inputContract', []), ensure_ascii=False)}\n"
        f"浣犵殑杈撳嚭濂戠害锛歿json.dumps(role_card.get('outputContract', []), ensure_ascii=False)}\n"
        f"浣犵殑璇勬祴鍏虫敞鐐癸細{json.dumps(role_card.get('evalFocus', []), ensure_ascii=False)}\n\n"
        f"鍙傝€冪郴缁熸彁绀鸿瘝鐗囨锛歕n{system_prompt[:1200]}\n\n"
        "璇蜂弗鏍煎彧杈撳嚭 JSON锛屼笉瑕佹坊鍔犺В閲娿€佹爣棰樻垨 Markdown 浠ｇ爜鍧椼€?
    )


def build_pack_prompt(lobster_id: str, industry: str, pack_type: str) -> str:
    instruction = LOBSTER_KB_INSTRUCTIONS.get(lobster_id, {}).get(pack_type, "")
    return (
        f"琛屼笟锛歿industry}\n\n"
        f"{instruction}\n\n"
        "璇蜂互 JSON 鏍煎紡杈撳嚭锛岃姹傦細\n"
        '- 椤跺眰瀛楁蹇呴』鍖呭惈: "industry", "lobster_id", "pack_type", "version", "items"\n'
        '- "items" 鏄暟缁勶紝姣忎釜 item 蹇呴』鍖呭惈: '
        '"id", "title", "description", "examples"(鏁扮粍), "priority"(high/medium/low)\n'
        "- 鑷冲皯鐢熸垚 8 鍒?12 涓?items\n"
        "- 鍏ㄩ儴鍐呭鐢ㄤ腑鏂囷紝蹇呰涓撲笟鏈鍙互淇濈暀鑻辨枃\n"
    )


def build_golden_cases_prompt(
    industry: str,
    existing_cases: dict[str, Any],
) -> str:
    existing_count = len(existing_cases.get("cases", []))
    existing_sample = json.dumps(existing_cases.get("cases", [])[:2], ensure_ascii=False, indent=2)
    return (
        f"琛屼笟锛歿industry}\n"
        f"褰撳墠宸叉湁 {existing_count} 涓噾妗堜緥锛屾牱渚嬪涓嬶細\n{existing_sample}\n\n"
        "璇烽澶栫敓鎴?6 涓珮璐ㄩ噺閲戞渚嬶紝瑕佹眰锛歕n"
        "- 2 涓?happy_path锛堟甯告垚鍔熸祦绋嬶級\n"
        "- 2 涓?edge_case锛堣竟鐣屾儏鍐碉級\n"
        "- 2 涓?failure_case锛堝け璐?闄嶇骇鍦烘櫙锛塡n\n"
        "姣忎釜妗堜緥鏍煎紡锛歕n"
        '{"id": "...", "label": "happy_path|edge_case|failure_case", '
        '"input": {...}, "expectedSignals": [...], "mustInclude": [...], "mustAvoid": [...]}'
        "\n\n杈撳嚭鏍煎紡锛歕n"
        '{"industry": "...", "cases": [...]}'
    )


# ---------------------------------------------------------------------------
# Generators
# ---------------------------------------------------------------------------

def generate_pack(
    *,
    lobster_id: str,
    industry: str,
    pack_type: str,
    role_card: dict[str, Any],
    system_prompt: str,
    model: str,
    base_url: str,
    api_keys: list[str],
    call_index: int,
    dry_run: bool,
) -> dict[str, Any]:
    system_msg = build_system_message(role_card, system_prompt)
    user_msg = build_pack_prompt(lobster_id, industry, pack_type)

    if dry_run:
        print(f"\n--- DRY RUN: {lobster_id} / {industry} / {pack_type} ---")
        print(f"System: {system_msg[:240]}...")
        print(f"User: {user_msg[:240]}...")
        return {
            "_dry_run": True,
            "lobster_id": lobster_id,
            "industry": industry,
            "pack_type": pack_type,
        }

    api_key = api_keys[call_index % len(api_keys)]
    print(f"  [LLM] Calling {lobster_id}/{industry}/{pack_type} ...")
    raw = _call_llm(
        user_msg,
        system=system_msg,
        model=model,
        base_url=base_url,
        api_key=api_key,
    )
    result = _parse_json_from_llm(raw)
    if isinstance(result, dict):
        result.setdefault("industry", industry)
        result.setdefault("lobster_id", lobster_id)
        result.setdefault("pack_type", pack_type)
        result.setdefault("version", "v0.1")
        result.setdefault("generated_at", time.strftime("%Y-%m-%dT%H:%M:%S%z"))
    return result


def generate_golden_cases(
    *,
    lobster_id: str,
    industry: str,
    role_card: dict[str, Any],
    system_prompt: str,
    existing_cases: dict[str, Any],
    model: str,
    base_url: str,
    api_keys: list[str],
    call_index: int,
    dry_run: bool,
) -> dict[str, Any]:
    system_msg = build_system_message(role_card, system_prompt)
    user_msg = build_golden_cases_prompt(industry, existing_cases)

    if dry_run:
        print(f"\n--- DRY RUN: {lobster_id} / {industry} / golden_cases ---")
        print(f"System: {system_msg[:240]}...")
        print(f"User: {user_msg[:240]}...")
        return {"_dry_run": True, "lobster_id": lobster_id, "industry": industry, "pack_type": "golden_cases"}

    api_key = api_keys[call_index % len(api_keys)]
    print(f"  [LLM] Calling {lobster_id}/{industry}/golden_cases ...")
    raw = _call_llm(
        user_msg,
        system=system_msg,
        model=model,
        base_url=base_url,
        api_key=api_key,
    )
    result = _parse_json_from_llm(raw)
    if isinstance(result, dict):
        result.setdefault("industry", industry)
        result.setdefault("lobster_id", lobster_id)
        result.setdefault("pack_type", "golden_cases")
        result.setdefault("version", "v0.1")
        result.setdefault("generated_at", time.strftime("%Y-%m-%dT%H:%M:%S%z"))
    return result


def save_pack(lobster_id: str, industry: str, pack_type: str, data: dict[str, Any]) -> Path:
    industry_slug = industry.replace("/", "_").replace(" ", "_")
    out_dir = OUTPUT_DIR / lobster_id / industry_slug
    out_dir.mkdir(parents=True, exist_ok=True)
    filename = PACK_TYPE_TO_FILENAME.get(pack_type, f"{pack_type}.json")
    out_path = out_dir / filename
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return out_path


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Generate lobster knowledge packs via OpenAI-compatible LLM")
    parser.add_argument("--lobster", default="all", help="Lobster ID or 'all'")
    parser.add_argument("--industries", default=None, help="Comma-separated industry list")
    parser.add_argument("--dry-run", action="store_true", help="Print prompts without calling LLM")
    parser.add_argument(
        "--pack-types",
        default="industry_rules,hooks,scoring,golden_cases",
        help="Comma-separated pack types",
    )
    args = parser.parse_args()

    api_keys = _load_api_keys()
    base_url = os.getenv("OPENAI_BASE_URL", "https://www.ananapi.com/").strip()
    model = os.getenv("OPENAI_MODEL", "gpt-5.4").strip()

    if not api_keys and not args.dry_run:
        print("[ERROR] OPENAI_API_KEY or OPENAI_API_KEYS not set. Use --dry-run to preview prompts.")
        sys.exit(1)

    lobster_ids = ALL_LOBSTER_IDS if args.lobster == "all" else [args.lobster]
    for lobster_id in lobster_ids:
        if lobster_id not in ALL_LOBSTER_IDS:
            print(f"[ERROR] Unknown lobster: {lobster_id}")
            sys.exit(1)

    industries = DEFAULT_INDUSTRIES
    if args.industries:
        industries = [item.strip() for item in args.industries.split(",") if item.strip()]

    pack_types = [item.strip() for item in args.pack_types.split(",") if item.strip()]
    valid_pack_types = {"industry_rules", "hooks", "scoring", "golden_cases"}
    invalid_pack_types = [item for item in pack_types if item not in valid_pack_types]
    if invalid_pack_types:
        print(f"[ERROR] Unknown pack types: {', '.join(invalid_pack_types)}")
        sys.exit(1)

    est_calls = len(lobster_ids) * len(industries) * len(pack_types)
    total_calls = 0
    total_saved = 0
    start_time = time.time()

    print("=" * 72)
    print("榫欒櫨鐭ヨ瘑鍖呮壒閲忓～鍏呰剼鏈?)
    print(f"   榫欒櫨: {', '.join(lobster_ids)}")
    print(f"   琛屼笟鏁伴噺: {len(industries)}")
    print(f"   鍖呯被鍨? {', '.join(pack_types)}")
    print(f"   妯″瀷: {model}")
    print(f"   API: {base_url}")
    print(f"   Dry Run: {args.dry_run}")
    print(f"   鍙敤 Key 鏁伴噺: {len(api_keys)}")
    print(f"   棰勪及璋冪敤娆℃暟: {est_calls}")
    if est_calls > 500:
        print("   [WARN] 杩欐槸涓€涓ぇ鎵归噺浠诲姟锛岃鍏堣€冭檻鍒嗘壒杩愯銆?)
    print("=" * 72)

    for lobster_id in lobster_ids:
        print(f"\n=== {lobster_id.upper()} ===")
        try:
            role_card = load_role_card(lobster_id)
            system_prompt = load_system_prompt(lobster_id)
            existing_golden = load_existing_golden_cases(lobster_id)
        except FileNotFoundError as exc:
            print(f"  [WARN] Skipping {lobster_id}: {exc}")
            continue

        print(f"  [OK] Loaded role-card: {role_card.get('zhName', lobster_id)} / {role_card.get('primaryArtifact', '')}")

        for industry in industries:
            print(f"\n  [INDUSTRY] {industry}")
            for pack_type in pack_types:
                if pack_type == "golden_cases":
                    result = generate_golden_cases(
                        lobster_id=lobster_id,
                        industry=industry,
                        role_card=role_card,
                        system_prompt=system_prompt,
                        existing_cases=existing_golden,
                        model=model,
                        base_url=base_url,
                        api_keys=api_keys,
                        call_index=total_calls,
                        dry_run=args.dry_run,
                    )
                else:
                    result = generate_pack(
                        lobster_id=lobster_id,
                        industry=industry,
                        pack_type=pack_type,
                        role_card=role_card,
                        system_prompt=system_prompt,
                        model=model,
                        base_url=base_url,
                        api_keys=api_keys,
                        call_index=total_calls,
                        dry_run=args.dry_run,
                    )
                total_calls += 1

                if not args.dry_run:
                    path = save_pack(lobster_id, industry, pack_type, result)
                    total_saved += 1
                    print(f"    [SAVED] {path.relative_to(REPO_ROOT)}")
                    time.sleep(1)

    elapsed = time.time() - start_time
    print("\n" + "=" * 72)
    print("瀹屾垚")
    print(f"   鎬昏皟鐢ㄦ鏁? {total_calls}")
    print(f"   鎬讳繚瀛樻枃浠? {total_saved}")
    print(f"   鑰楁椂: {elapsed:.1f} 绉?)
    print(f"   杈撳嚭鐩綍: {OUTPUT_DIR.relative_to(REPO_ROOT)}")
    print("   鎻愰啋锛氳剼鏈彧鑳界粺璁¤皟鐢ㄦ鏁帮紝鏃犳硶绮剧‘鍒ゆ柇绗笁鏂瑰钩鍙颁綑棰濇槸鍚︾湡姝ｈ€楀敖銆?)
    print("=" * 72)


if __name__ == "__main__":
    main()

