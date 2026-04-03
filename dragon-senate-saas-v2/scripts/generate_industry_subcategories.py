#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path


def _schema(industry_name: str) -> dict:
    return {
        "industry_name": industry_name,
        "pain_points": [],
        "jargon_terms": [],
        "solutions": [],
        "objections": [],
        "banned_absolute": ["全网第一", "稳赚不赔", "保证收益", "100%有效"],
        "banned_industry": ["刷单上榜", "平台漏洞套利"],
        "risk_behaviors": ["违规导流", "夸大承诺", "虚假案例", "诱导交易"],
    }


CATEGORIES = [
    (
        "food_service",
        "餐饮服务",
        [
            ("food_chinese_restaurant", "中餐馆", ["中餐馆", "中餐", "餐馆"]),
            ("food_hotpot", "火锅店", ["火锅店", "火锅"]),
            ("food_bbq", "烧烤店", ["烧烤店", "烧烤"]),
            ("food_tea_shop", "奶茶店", ["奶茶店", "奶茶", "茶饮"]),
            ("food_coffee_shop", "咖啡店", ["咖啡店", "咖啡"]),
            ("food_bakery", "烘焙店", ["烘焙店", "烘焙", "面包店"]),
            ("food_fastfood", "快餐店", ["快餐店", "快餐"]),
        ],
    ),
    (
        "hotel_lodging",
        "酒店民宿",
        [
            ("hotel_business", "商务酒店", ["商务酒店"]),
            ("hotel_resort", "度假酒店", ["度假酒店"]),
            ("hotel_boutique_bnb", "精品民宿", ["精品民宿", "民宿"]),
            ("hotel_city_bnb", "城市民宿", ["城市民宿"]),
            ("hotel_inn", "客栈", ["客栈"]),
        ],
    ),
    (
        "beauty_health",
        "美业健康",
        [
            ("beauty_salon", "美容院", ["美容院"]),
            ("beauty_nail", "美甲店", ["美甲店", "美甲"]),
            ("beauty_hair", "美发店", ["美发店", "理发店"]),
            ("beauty_light_med", "轻医美机构", ["轻医美机构", "轻医美", "医美"]),
            ("beauty_skin", "皮肤管理", ["皮肤管理"]),
            ("beauty_wellness", "养生馆", ["养生馆"]),
            ("beauty_rehab", "理疗馆", ["理疗馆"]),
        ],
    ),
    (
        "education_training",
        "教育培训",
        [
            ("edu_vocational", "职业教育", ["职业教育"]),
            ("edu_language", "语言培训", ["语言培训"]),
            ("edu_postgrad", "考研培训", ["考研培训"]),
            ("edu_arts", "艺术培训", ["艺术培训"]),
            ("edu_kids", "少儿素质教育", ["少儿素质教育"]),
            ("edu_adult_skills", "成人技能培训", ["成人技能培训"]),
        ],
    ),
    (
        "auto_services",
        "汽车服务",
        [
            ("auto_used_car", "二手车门店", ["二手车门店", "二手车"]),
            ("auto_new_car", "新车经销", ["新车经销"]),
            ("auto_detailing", "汽车美容", ["汽车美容"]),
            ("auto_repair", "汽车维修", ["汽车维修"]),
            ("auto_mod", "汽车改装", ["汽车改装"]),
            ("auto_rental", "汽车租赁", ["汽车租赁"]),
        ],
    ),
    (
        "home_renovation",
        "家居装修",
        [
            ("home_decor_company", "装修公司", ["装修公司"]),
            ("home_custom", "全屋定制", ["全屋定制"]),
            ("home_materials", "家居建材", ["家居建材"]),
            ("home_appliances", "家电门店", ["家电门店"]),
            ("home_smart", "智能家居", ["智能家居"]),
            ("home_soft", "软装设计", ["软装设计"]),
        ],
    ),
    (
        "local_retail",
        "本地零售",
        [
            ("retail_fresh", "生鲜门店", ["生鲜门店", "生鲜"]),
            ("retail_supermarket", "社区超市", ["社区超市"]),
            ("retail_maternity", "母婴门店", ["母婴门店"]),
            ("retail_pet", "宠物门店", ["宠物门店"]),
            ("retail_tobacco_alcohol", "烟酒店", ["烟酒店"]),
            ("retail_pharmacy", "药店", ["药店"]),
        ],
    ),
    (
        "life_services",
        "生活服务",
        [
            ("life_housekeeping", "家政服务", ["家政服务", "家政"]),
            ("life_moving", "搬家服务", ["搬家服务"]),
            ("life_laundry", "洗衣洗护", ["洗衣洗护", "洗护"]),
            ("life_locksmith", "开锁服务", ["开锁服务"]),
            ("life_plumbing", "管道维修", ["管道维修"]),
            ("life_appliance_clean", "家电清洗", ["家电清洗"]),
        ],
    ),
    (
        "medical_health",
        "医疗健康",
        [
            ("medical_dental", "口腔门诊", ["口腔门诊"]),
            ("medical_eye", "眼科门诊", ["眼科门诊"]),
            ("medical_checkup", "体检中心", ["体检中心"]),
            ("medical_rehab", "康复中心", ["康复中心"]),
            ("medical_tcm_clinic", "中医诊所", ["中医诊所", "中医"]),
            ("medical_psych", "心理咨询", ["心理咨询"]),
        ],
    ),
    (
        "enterprise_services",
        "企业服务",
        [
            ("enterprise_tax", "财税服务", ["财税服务"]),
            ("enterprise_legal", "法律服务", ["法律服务"]),
            ("enterprise_hr", "人力资源", ["人力资源"]),
            ("enterprise_software", "软件服务", ["软件服务", "SaaS"]),
            ("enterprise_ip", "知识产权", ["知识产权"]),
            ("enterprise_consulting", "咨询服务", ["咨询服务"]),
        ],
    ),
    (
        "travel_leisure",
        "文旅休闲",
        [
            ("travel_scenic", "景区乐园", ["景区乐园", "景区"]),
            ("travel_agency", "旅行社", ["旅行社"]),
            ("travel_camping", "露营基地", ["露营基地"]),
            ("travel_gym", "健身房", ["健身房"]),
            ("travel_yoga", "瑜伽馆", ["瑜伽馆"]),
            ("travel_cinema", "影城剧场", ["影城剧场", "影城"]),
        ],
    ),
    (
        "crossborder_ecommerce",
        "电商出海",
        [
            ("overseas_crossborder", "跨境电商", ["跨境电商"]),
            ("overseas_factory", "外贸工厂", ["外贸工厂"]),
            ("overseas_dtc", "独立站运营", ["独立站运营", "独立站"]),
            ("overseas_warehouse", "海外仓服务", ["海外仓服务", "海外仓"]),
            ("overseas_logistics", "国际物流", ["国际物流"]),
        ],
    ),
]


def build_taxonomy() -> list[dict]:
    rows: list[dict] = []
    for category_tag, category_name, subs in CATEGORIES:
        sub_rows = []
        for tag, name, aliases in subs:
            sub_rows.append(
                {
                    "tag": tag,
                    "name": name,
                    "aliases": aliases,
                    "schema": _schema(name),
                }
            )
        rows.append(
            {
                "category_tag": category_tag,
                "category_name": category_name,
                "sub_industries": sub_rows,
            }
        )
    return rows


def main() -> int:
    out_path = Path(__file__).resolve().parents[2] / "docs" / "industry_subcategories.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = build_taxonomy()
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    total = sum(len(item["sub_industries"]) for item in payload)
    print(f"written: {out_path}")
    print(f"categories: {len(payload)} subindustries: {total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

