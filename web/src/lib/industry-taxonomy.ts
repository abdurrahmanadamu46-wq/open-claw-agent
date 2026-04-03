export type KnowledgeSchema = {
  industry_name: string;
  pain_points: string[];
  jargon_terms: string[];
  solutions: string[];
  objections: string[];
  banned_absolute: string[];
  banned_industry: string[];
  risk_behaviors: string[];
};

export type SubIndustry = {
  tag: string;
  name: string;
  aliases: string[];
  schema: KnowledgeSchema;
};

export type IndustryCategory = {
  category_tag: string;
  category_name: string;
  sub_industries: SubIndustry[];
};

function schema(industryName: string): KnowledgeSchema {
  return {
    industry_name: industryName,
    pain_points: [],
    jargon_terms: [],
    solutions: [],
    objections: [],
    banned_absolute: ['保证赚钱', '百分百成交', '立刻暴富', '稳赚不赔'],
    banned_industry: [],
    risk_behaviors: ['夸大宣传', '虚假对比', '违规承诺', '诱导交易'],
  };
}

export const INDUSTRY_TAXONOMY: IndustryCategory[] = [
  {
    category_tag: 'food_service',
    category_name: '餐饮服务',
    sub_industries: [
      { tag: 'food_chinese_restaurant', name: '中餐馆', aliases: ['中餐馆', '中餐', '餐馆'], schema: schema('中餐馆') },
      { tag: 'food_hotpot', name: '火锅店', aliases: ['火锅店', '火锅'], schema: schema('火锅店') },
      { tag: 'food_bbq', name: '烧烤店', aliases: ['烧烤店', '烧烤'], schema: schema('烧烤店') },
      { tag: 'food_tea_shop', name: '奶茶店', aliases: ['奶茶店', '奶茶', '茶饮'], schema: schema('奶茶店') },
      { tag: 'food_coffee_shop', name: '咖啡店', aliases: ['咖啡店', '咖啡馆', '咖啡'], schema: schema('咖啡店') },
      { tag: 'food_bakery', name: '烘焙店', aliases: ['烘焙店', '面包店', '甜品店'], schema: schema('烘焙店') },
      { tag: 'food_fast_food', name: '快餐店', aliases: ['快餐店', '快餐'], schema: schema('快餐店') },
    ],
  },
  {
    category_tag: 'hotel_lodging',
    category_name: '酒店民宿',
    sub_industries: [
      { tag: 'hotel_business', name: '商务酒店', aliases: ['商务酒店'], schema: schema('商务酒店') },
      { tag: 'hotel_resort', name: '度假酒店', aliases: ['度假酒店'], schema: schema('度假酒店') },
      { tag: 'hotel_boutique_homestay', name: '精品民宿', aliases: ['精品民宿'], schema: schema('精品民宿') },
      { tag: 'hotel_city_homestay', name: '城市民宿', aliases: ['城市民宿'], schema: schema('城市民宿') },
      { tag: 'hotel_inn', name: '客栈', aliases: ['客栈'], schema: schema('客栈') },
      { tag: 'hotel_apartment', name: '公寓酒店', aliases: ['公寓酒店'], schema: schema('公寓酒店') },
    ],
  },
  {
    category_tag: 'beauty_health',
    category_name: '美业健康',
    sub_industries: [
      { tag: 'beauty_salon', name: '美容院', aliases: ['美容院'], schema: schema('美容院') },
      { tag: 'beauty_nail', name: '美甲店', aliases: ['美甲店', '美甲'], schema: schema('美甲店') },
      { tag: 'beauty_hair', name: '美发店', aliases: ['美发店', '理发店'], schema: schema('美发店') },
      { tag: 'beauty_light_medical', name: '轻医美机构', aliases: ['轻医美机构', '轻医美', '医美'], schema: schema('轻医美机构') },
      { tag: 'beauty_skin_care', name: '皮肤管理', aliases: ['皮肤管理'], schema: schema('皮肤管理') },
      { tag: 'beauty_wellness', name: '养生馆', aliases: ['养生馆'], schema: schema('养生馆') },
      { tag: 'beauty_therapy', name: '理疗馆', aliases: ['理疗馆'], schema: schema('理疗馆') },
    ],
  },
  {
    category_tag: 'education_training',
    category_name: '教育培训',
    sub_industries: [
      { tag: 'edu_vocational', name: '职业教育', aliases: ['职业教育'], schema: schema('职业教育') },
      { tag: 'edu_language', name: '语言培训', aliases: ['语言培训'], schema: schema('语言培训') },
      { tag: 'edu_postgraduate', name: '考研培训', aliases: ['考研培训'], schema: schema('考研培训') },
      { tag: 'edu_arts', name: '艺术培训', aliases: ['艺术培训'], schema: schema('艺术培训') },
      { tag: 'edu_kids_quality', name: '少儿素质教育', aliases: ['少儿素质教育'], schema: schema('少儿素质教育') },
      { tag: 'edu_adult_skill', name: '成人技能培训', aliases: ['成人技能培训'], schema: schema('成人技能培训') },
    ],
  },
  {
    category_tag: 'auto_service',
    category_name: '汽车服务',
    sub_industries: [
      { tag: 'auto_used_car', name: '二手车门店', aliases: ['二手车门店', '二手车'], schema: schema('二手车门店') },
      { tag: 'auto_new_car', name: '新车经销', aliases: ['新车经销'], schema: schema('新车经销') },
      { tag: 'auto_beauty', name: '汽车美容', aliases: ['汽车美容'], schema: schema('汽车美容') },
      { tag: 'auto_repair', name: '汽车维修', aliases: ['汽车维修'], schema: schema('汽车维修') },
      { tag: 'auto_modification', name: '汽车改装', aliases: ['汽车改装'], schema: schema('汽车改装') },
      { tag: 'auto_rental', name: '汽车租赁', aliases: ['汽车租赁'], schema: schema('汽车租赁') },
    ],
  },
  {
    category_tag: 'home_renovation',
    category_name: '家居装修',
    sub_industries: [
      { tag: 'home_renovation', name: '装修公司', aliases: ['装修公司'], schema: schema('装修公司') },
      { tag: 'home_customization', name: '全屋定制', aliases: ['全屋定制'], schema: schema('全屋定制') },
      { tag: 'home_materials', name: '家居建材', aliases: ['家居建材'], schema: schema('家居建材') },
      { tag: 'home_appliance_store', name: '家电门店', aliases: ['家电门店'], schema: schema('家电门店') },
      { tag: 'home_smart', name: '智能家居', aliases: ['智能家居'], schema: schema('智能家居') },
      { tag: 'home_soft_design', name: '软装设计', aliases: ['软装设计'], schema: schema('软装设计') },
    ],
  },
  {
    category_tag: 'local_retail',
    category_name: '本地零售',
    sub_industries: [
      { tag: 'retail_fresh', name: '生鲜门店', aliases: ['生鲜门店', '生鲜'], schema: schema('生鲜门店') },
      { tag: 'retail_community_supermarket', name: '社区超市', aliases: ['社区超市'], schema: schema('社区超市') },
      { tag: 'retail_maternal_baby', name: '母婴门店', aliases: ['母婴门店'], schema: schema('母婴门店') },
      { tag: 'retail_pet', name: '宠物门店', aliases: ['宠物门店'], schema: schema('宠物门店') },
      { tag: 'retail_tobacco_wine', name: '烟酒店', aliases: ['烟酒店'], schema: schema('烟酒店') },
      { tag: 'retail_pharmacy', name: '药店', aliases: ['药店'], schema: schema('药店') },
    ],
  },
  {
    category_tag: 'life_service',
    category_name: '生活服务',
    sub_industries: [
      { tag: 'life_housekeeping', name: '家政服务', aliases: ['家政服务', '家政'], schema: schema('家政服务') },
      { tag: 'life_moving', name: '搬家服务', aliases: ['搬家服务', '搬家'], schema: schema('搬家服务') },
      { tag: 'life_laundry', name: '洗衣洗护', aliases: ['洗衣洗护'], schema: schema('洗衣洗护') },
      { tag: 'life_locksmith', name: '开锁服务', aliases: ['开锁服务', '开锁'], schema: schema('开锁服务') },
      { tag: 'life_plumbing', name: '管道维修', aliases: ['管道维修'], schema: schema('管道维修') },
      { tag: 'life_appliance_cleaning', name: '家电清洗', aliases: ['家电清洗'], schema: schema('家电清洗') },
    ],
  },
  {
    category_tag: 'medical_health',
    category_name: '医疗健康',
    sub_industries: [
      { tag: 'medical_dental', name: '口腔门诊', aliases: ['口腔门诊'], schema: schema('口腔门诊') },
      { tag: 'medical_ophthalmology', name: '眼科门诊', aliases: ['眼科门诊'], schema: schema('眼科门诊') },
      { tag: 'medical_checkup', name: '体检中心', aliases: ['体检中心'], schema: schema('体检中心') },
      { tag: 'medical_rehab', name: '康复中心', aliases: ['康复中心'], schema: schema('康复中心') },
      { tag: 'medical_tcm_clinic', name: '中医诊所', aliases: ['中医诊所', '中医馆'], schema: schema('中医诊所') },
      { tag: 'medical_psychology', name: '心理咨询', aliases: ['心理咨询'], schema: schema('心理咨询') },
    ],
  },
  {
    category_tag: 'enterprise_service',
    category_name: '企业服务',
    sub_industries: [
      { tag: 'enterprise_tax', name: '财税服务', aliases: ['财税服务'], schema: schema('财税服务') },
      { tag: 'enterprise_legal', name: '法律服务', aliases: ['法律服务'], schema: schema('法律服务') },
      { tag: 'enterprise_hr', name: '人力资源', aliases: ['人力资源'], schema: schema('人力资源') },
      { tag: 'enterprise_software', name: '软件服务', aliases: ['软件服务', 'SaaS'], schema: schema('软件服务') },
      { tag: 'enterprise_ip', name: '知识产权', aliases: ['知识产权'], schema: schema('知识产权') },
      { tag: 'enterprise_consulting', name: '咨询服务', aliases: ['咨询服务'], schema: schema('咨询服务') },
    ],
  },
  {
    category_tag: 'travel_leisure',
    category_name: '文旅休闲',
    sub_industries: [
      { tag: 'travel_scenic', name: '景区乐园', aliases: ['景区乐园'], schema: schema('景区乐园') },
      { tag: 'travel_agency', name: '旅行社', aliases: ['旅行社'], schema: schema('旅行社') },
      { tag: 'travel_camping', name: '露营基地', aliases: ['露营基地'], schema: schema('露营基地') },
      { tag: 'travel_gym', name: '健身房', aliases: ['健身房'], schema: schema('健身房') },
      { tag: 'travel_yoga', name: '瑜伽馆', aliases: ['瑜伽馆'], schema: schema('瑜伽馆') },
      { tag: 'travel_theater', name: '影城剧场', aliases: ['影城剧场'], schema: schema('影城剧场') },
    ],
  },
  {
    category_tag: 'ecommerce_overseas',
    category_name: '电商出海',
    sub_industries: [
      { tag: 'overseas_crossborder', name: '跨境电商', aliases: ['跨境电商'], schema: schema('跨境电商') },
      { tag: 'overseas_factory', name: '外贸工厂', aliases: ['外贸工厂'], schema: schema('外贸工厂') },
      { tag: 'overseas_independent_site', name: '独立站运营', aliases: ['独立站运营', 'Shopify'], schema: schema('独立站运营') },
      { tag: 'overseas_warehouse', name: '海外仓服务', aliases: ['海外仓服务'], schema: schema('海外仓服务') },
      { tag: 'overseas_global_logistics', name: '国际物流', aliases: ['国际物流'], schema: schema('国际物流') },
    ],
  },
];

export function flattenSubIndustries(): Array<SubIndustry & { category_tag: string; category_name: string }> {
  return INDUSTRY_TAXONOMY.flatMap((category) =>
    category.sub_industries.map((sub) => ({
      ...sub,
      category_tag: category.category_tag,
      category_name: category.category_name,
    })),
  );
}

export function findSubIndustryByTag(tag?: string | null) {
  if (!tag) return null;
  const target = String(tag).trim().toLowerCase();
  return flattenSubIndustries().find((row) => row.tag === target) ?? null;
}

