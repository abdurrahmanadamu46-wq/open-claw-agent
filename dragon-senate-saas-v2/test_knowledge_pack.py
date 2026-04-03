from knowledge_pack_loader import load_industry_section


def main() -> None:
    result = load_industry_section("radar", "中餐馆")
    assert len(result) > 100, "知识包为空"

    result2 = load_industry_section("radar", "不存在的行业")
    assert result2 == "", "找不到应返回空字符串"

    print("OK")


if __name__ == "__main__":
    main()
